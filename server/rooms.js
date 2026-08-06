import crypto from 'node:crypto';
import { createGame } from './game.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function defaultCode() {
  return Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
}

function cleanName(name) {
  const value = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (value.length < 1 || value.length > 18) throw new Error('Name must be 1–18 characters');
  return value;
}

export function createRoomStore(codeGenerator = defaultCode, { maxRooms = 500 } = {}) {
  const rooms = new Map();
  const sockets = new Map();

  function uniqueCode() {
    for (let attempts = 0; attempts < 20; attempts += 1) {
      const code = codeGenerator().toUpperCase();
      if (!rooms.has(code)) return code;
    }
    throw new Error('Could not create a unique room');
  }

  function addPlayer(room, { name, socketId }) {
    if (room.game.phase !== 'waiting') throw new Error('A hand is already running');
    if (room.game.players.length >= 8) throw new Error('This table is full');
    const safeName = cleanName(name);
    if (room.game.players.some((player) => player.name.toLowerCase() === safeName.toLowerCase())) {
      throw new Error('That name is already at the table');
    }
    const player = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString('base64url'),
      socketId,
      name: safeName,
      stack: 1000,
      connected: true,
      isHost: room.game.players.length === 0,
    };
    room.game.players.push(player);
    sockets.set(socketId, { roomCode: room.code, playerId: player.id });
    return player;
  }

  function findByToken(room, token) {
    if (!token) return null;
    return room.game.players.find((player) => player.token === token) ?? null;
  }

  return {
    create({ name, socketId }) {
      if (rooms.size >= maxRooms) throw new Error('Too many active rooms; try again later');
      const code = uniqueCode();
      const room = { code, game: createGame(), createdAt: Date.now() };
      rooms.set(code, room);
      const player = addPlayer(room, { name, socketId });
      return { room, player };
    },

    join({ code, name, socketId, token }) {
      const normalized = String(code ?? '').trim().toUpperCase();
      const room = rooms.get(normalized);
      if (!room) throw new Error('Room not found');
      let player = findByToken(room, token);
      if (player) {
        if (player.socketId) sockets.delete(player.socketId);
        player.socketId = socketId;
        player.connected = true;
        sockets.set(socketId, { roomCode: room.code, playerId: player.id });
      } else player = addPlayer(room, { name, socketId });
      return { room, player };
    },

    disconnect(socketId) {
      const membership = sockets.get(socketId);
      if (!membership) return null;
      sockets.delete(socketId);
      const room = rooms.get(membership.roomCode);
      const player = room?.game.players.find((candidate) => candidate.id === membership.playerId);
      if (player) {
        player.connected = false;
        player.socketId = null;
        if (player.isHost) {
          const replacement = room.game.players.find((candidate) => candidate.connected && candidate.id !== player.id);
          if (replacement) {
            player.isHost = false;
            replacement.isHost = true;
          }
        }
      }
      return room && player ? { room, player } : null;
    },

    membership(socketId) {
      const membership = sockets.get(socketId);
      if (!membership) return null;
      const room = rooms.get(membership.roomCode);
      const player = room?.game.players.find((candidate) => candidate.id === membership.playerId);
      return room && player ? { room, player } : null;
    },
  };
}
