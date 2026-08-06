import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { ACTIONS, act, publicState, startHand } from './game.js';
import { createRoomStore } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { serveClient: true });
const rooms = createRoomStore();
const PORT = Number(process.env.PORT) || 3000;
const REACTIONS = new Set(['😂', '🔥', '😮', '👏', '😭', '🤔', '❤️', '🫡']);

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
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

io.on('connection', (socket) => {
  socket.on('create-room', (payload = {}, ack = () => {}) => {
    try {
      const { room, player } = rooms.create({ name: payload.name, socketId: socket.id });
      socket.join(room.code);
      ack({ ok: true, code: room.code, token: player.token });
      emitRoom(room);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error) });
    }
  });

  socket.on('join-room', (payload = {}, ack = () => {}) => {
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

  socket.on('start-hand', (_payload, ack = () => {}) => {
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

  socket.on('react', (payload = {}, ack = () => {}) => {
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
  console.log(`Family Hold’em listening on http://0.0.0.0:${PORT}`);
});
