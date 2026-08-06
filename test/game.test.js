import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  createDeck,
  createGame,
  publicState,
  startHand,
  act,
} from '../server/game.js';

function gameWithPlayers(count = 4, stack = 1000) {
  const game = createGame({ smallBlind: 10, bigBlind: 20 });
  for (let i = 0; i < count; i += 1) {
    game.players.push({
      id: `p${i + 1}`,
      name: `Player ${i + 1}`,
      stack,
      connected: true,
    });
  }
  return game;
}

describe('server-authoritative deck', () => {
  it('creates exactly 52 unique cards', () => {
    const deck = createDeck(() => 0.42);
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck).size, 52);
  });

  it('never duplicates cards across hands and board', () => {
    const game = gameWithPlayers(8);
    startHand(game, () => 0.37);
    const visible = game.players.flatMap((player) => player.hand);
    assert.equal(visible.length, 16);
    assert.equal(new Set([...visible, ...game.deck]).size, 52);
  });
});

describe('private state', () => {
  it('only reveals the requesting player hole cards during a live hand', () => {
    const game = gameWithPlayers(3);
    startHand(game, () => 0.25);
    const view = publicState(game, 'p1');
    assert.equal(view.players.find((p) => p.id === 'p1').hand.length, 2);
    assert.equal(view.players.find((p) => p.id === 'p2').hand.length, 0);
    assert.equal('deck' in view, false);
  });
});

describe('betting flow', () => {
  it('moves from preflop to flop after every live player matches the bet', () => {
    const game = gameWithPlayers(3);
    startHand(game, () => 0.19);
    while (game.phase === 'preflop') {
      const player = game.players.find((p) => p.id === game.currentActor);
      const toCall = game.currentBet - player.bet;
      act(game, player.id, toCall === 0 ? { type: ACTIONS.CHECK } : { type: ACTIONS.CALL });
    }
    assert.equal(game.phase, 'flop');
    assert.equal(game.community.length, 3);
  });

  it('awards the pot immediately when everyone else folds', () => {
    const game = gameWithPlayers(3);
    startHand(game, () => 0.11);
    const survivor = game.currentActor;
    const before = game.players.find((p) => p.id === survivor).stack;
    for (let i = 0; i < 2 && game.phase !== 'waiting'; i += 1) {
      const actor = game.currentActor;
      if (actor === survivor) act(game, actor, { type: ACTIONS.CALL });
      else act(game, actor, { type: ACTIONS.FOLD });
    }
    if (game.phase !== 'waiting') {
      const actor = game.currentActor;
      act(game, actor, { type: ACTIONS.FOLD });
    }
    assert.equal(game.phase, 'waiting');
    assert.ok(game.players.find((p) => p.id === survivor).stack > before);
  });

  it('rejects actions from a player whose turn it is not', () => {
    const game = gameWithPlayers(3);
    startHand(game, () => 0.61);
    const wrong = game.players.find((p) => p.id !== game.currentActor);
    assert.throws(() => act(game, wrong.id, { type: ACTIONS.FOLD }), /turn/i);
  });
});
