import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomStore } from '../server/rooms.js';

describe('room store', () => {
  it('creates a private room and makes its creator the host', () => {
    const rooms = createRoomStore(() => 'ABC123');
    const joined = rooms.create({ name: 'Daniel', socketId: 's1' });
    assert.equal(joined.room.code, 'ABC123');
    assert.equal(joined.player.isHost, true);
    assert.equal(joined.player.stack, 1000);
  });

  it('uses the host-selected starting stack for every new player', () => {
    const rooms = createRoomStore(() => 'ABC123');
    const hosted = rooms.create({ name: 'Daniel', socketId: 's1', startingStack: 2500 });
    const joined = rooms.join({ code: 'ABC123', name: 'Family', socketId: 's2' });
    assert.equal(hosted.room.game.startingStack, 2500);
    assert.equal(hosted.player.stack, 2500);
    assert.equal(joined.player.stack, 2500);
  });

  it('lets a token reconnect to the same seat without adding a player', () => {
    const rooms = createRoomStore(() => 'ABC123');
    const first = rooms.create({ name: 'Daniel', socketId: 's1' });
    rooms.disconnect('s1');
    const second = rooms.join({ code: 'ABC123', name: 'Ignored', socketId: 's2', token: first.player.token });
    assert.equal(second.player.id, first.player.id);
    assert.equal(second.room.game.players.length, 1);
    assert.equal(second.player.connected, true);
  });

  it('returns host control to the room creator when they reconnect', () => {
    const rooms = createRoomStore(() => 'ABC123');
    const creator = rooms.create({ name: 'Daniel', socketId: 's1' });
    const replacement = rooms.join({ code: 'ABC123', name: 'Test Bot', socketId: 's2' });
    rooms.disconnect('s1');
    assert.equal(replacement.player.isHost, true);

    const rejoined = rooms.join({ code: 'ABC123', name: 'Ignored', socketId: 's3', token: creator.player.token });
    assert.equal(rejoined.player.isHost, true);
    assert.equal(replacement.player.isHost, false);
  });

  it('rejects a duplicate display name in one room', () => {
    const store = createRoomStore(() => 'ABC123');
    const { room } = store.create({ name: 'Daniel', socketId: 'socket-a' });
    assert.throws(
      () => store.join({ code: room.code, name: 'daniel', socketId: 'socket-b' }),
      /already at the table/,
    );
  });

  it('caps the number of rooms to prevent memory exhaustion', () => {
    const codes = ['ABC123', 'DEF456'];
    const store = createRoomStore(() => codes.shift(), { maxRooms: 1 });
    store.create({ name: 'Daniel', socketId: 'socket-a' });
    assert.throws(() => store.create({ name: 'Family', socketId: 'socket-b' }), /Too many active rooms/);
  });
});
