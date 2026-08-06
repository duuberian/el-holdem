import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { ACTIONS, act, exchangePlayerChip, publicState, setStartingStack, startHand } from './game.js';
import { createRoomStore } from './rooms.js';
import {
  cacheControlForPath,
  createRateLimiter,
  isAllowedOrigin,
  safeAck,
  securityHeaders,
} from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  serveClient: true,
  maxHttpBufferSize: 10_000,
  perMessageDeflate: false,
  allowRequest: (request, callback) => callback(null, isAllowedOrigin({
    origin: request.headers.origin,
    host: request.headers.host,
  })),
});
const rooms = createRoomStore();
const connectionLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
const eventLimiter = createRateLimiter({ limit: 120, windowMs: 10_000 });
const roomOperationLimiter = createRateLimiter({ limit: 12, windowMs: 60_000 });
const PORT = Number(process.env.PORT) || 3000;
const REACTIONS = new Set(['😂', '🔥', '😮', '👏', '😭', '🤔', '❤️', '🫡']);

app.disable('x-powered-by');
app.use((_request, response, next) => {
  response.set(securityHeaders());
  if (process.env.NODE_ENV === 'production') {
    response.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  maxAge: '1h',
  setHeaders: (response, filePath) => response.setHeader('Cache-Control', cacheControlForPath(filePath)),
}));
app.get('/health', (_request, response) => response.json({ ok: true }));

function errorMessage(error) {
  return error instanceof Error ? error.message : 'Something went wrong';
}

function emitRoom(room) {
  for (const player of room.game.players) {
    if (!player.connected || !player.socketId) continue;
    io.to(player.socketId).emit('state', {
      roomCode: room.code,
      isHost: player.isHost,
      selfId: player.id,
      state: publicState(room.game, player.id),
    });
  }
}

function withMembership(socket, callback, ack = () => {}) {
  try {
    const membership = rooms.membership(socket.id);
    if (!membership) throw new Error('Join a room first');
    callback(membership);
  } catch (error) {
    ack({ ok: false, error: errorMessage(error) });
  }
}

function clientIp(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  return String(forwarded ?? socket.handshake.address ?? 'unknown').split(',')[0].trim().slice(0, 64);
}

function allowEvent(socket, ack, roomOperation = false) {
  if (!eventLimiter.allow(socket.id) || (roomOperation && !roomOperationLimiter.allow(clientIp(socket)))) {
    ack({ ok: false, error: 'Too many requests; wait a moment and try again' });
    return false;
  }
  return true;
}

io.use((socket, next) => {
  if (!connectionLimiter.allow(clientIp(socket))) {
    next(new Error('Too many connections; wait a minute and try again'));
    return;
  }
  next();
});

io.on('connection', (socket) => {
  socket.on('create-room', (payload = {}, ack = () => {}) => {
    ack = safeAck(ack);
    if (!allowEvent(socket, ack, true)) return;
    try {
      const { room, player } = rooms.create({ name: payload.name, startingStack: payload.startingStack, socketId: socket.id });
      socket.join(room.code);
      ack({ ok: true, code: room.code, token: player.token });
      emitRoom(room);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error) });
    }
  });

  socket.on('join-room', (payload = {}, ack = () => {}) => {
    ack = safeAck(ack);
    if (!allowEvent(socket, ack, true)) return;
    try {
      const { room, player } = rooms.join({
        code: payload.code,
        name: payload.name,
        token: payload.token,
        socketId: socket.id,
      });
      socket.join(room.code);
      ack({ ok: true, code: room.code, token: player.token });
      emitRoom(room);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error) });
    }
  });

  socket.on('set-starting-stack', (payload = {}, ack = () => {}) => {
    ack = safeAck(ack);
    if (!allowEvent(socket, ack)) return;
    withMembership(socket, ({ room, player }) => {
      try {
        if (!player.isHost) throw new Error('Only the host can change starting chips');
        const startingStack = setStartingStack(room.game, payload.startingStack);
        emitRoom(room);
        ack({ ok: true, startingStack });
      } catch (error) {
        ack({ ok: false, error: errorMessage(error) });
      }
    }, ack);
  });

  socket.on('start-hand', (_payload, ack = () => {}) => {
    ack = safeAck(ack);
    if (!allowEvent(socket, ack)) return;
    withMembership(socket, ({ room, player }) => {
      try {
        if (!player.isHost) throw new Error('Only the host can deal');
        startHand(room.game);
        emitRoom(room);
        ack({ ok: true });
      } catch (error) {
        ack({ ok: false, error: errorMessage(error) });
      }
    }, ack);
  });

  socket.on('action', (payload = {}, ack = () => {}) => {
    ack = safeAck(ack);
    if (!allowEvent(socket, ack)) return;
    withMembership(socket, ({ room, player }) => {
      try {
        const type = String(payload.type ?? '');
        if (!Object.values(ACTIONS).includes(type)) throw new Error('Invalid action');
        act(room.game, player.id, { type, amount: payload.amount });
        emitRoom(room);
        ack({ ok: true });
      } catch (error) {
        ack({ ok: false, error: errorMessage(error) });
      }
    }, ack);
  });

  socket.on('exchange-chip', (payload = {}, ack = () => {}) => {
    ack = safeAck(ack);
    if (!allowEvent(socket, ack)) return;
    withMembership(socket, ({ room, player }) => {
      try {
        exchangePlayerChip(room.game, player.id, payload.denomination, payload.direction ?? 'down');
        emitRoom(room);
        ack({ ok: true });
      } catch (error) {
        ack({ ok: false, error: errorMessage(error) });
      }
    }, ack);
  });

  socket.on('react', (payload = {}, ack = () => {}) => {
    ack = safeAck(ack);
    if (!allowEvent(socket, ack)) return;
    withMembership(socket, ({ room, player }) => {
      const emoji = String(payload.emoji ?? '');
      if (!REACTIONS.has(emoji)) {
        ack({ ok: false, error: 'Invalid reaction' });
        return;
      }
      io.to(room.code).emit('reaction', { playerId: player.id, name: player.name, emoji, at: Date.now() });
      ack({ ok: true });
    }, ack);
  });

  socket.on('disconnect', () => {
    const result = rooms.disconnect(socket.id);
    if (!result) return;
    if (result.room.game.currentActor === result.player.id && result.room.game.phase !== 'waiting') {
      try { act(result.room.game, result.player.id, { type: ACTIONS.FOLD }); } catch { /* state broadcast still runs */ }
    }
    emitRoom(result.room);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`EL Holdem listening on http://0.0.0.0:${PORT}`);
});
