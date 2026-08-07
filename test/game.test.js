import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  createDeck,
  createGame,
  exchangePlayerChip,
  publicState,
  setStartingStack,
  startHand,
  startNewGame,
  act,
} from '../server/game.js';
import { chipRackValue } from '../server/chips.js';

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

function assertChipBacked(game) {
  for (const player of game.players) {
    assert.equal(chipRackValue(player.chips), player.stack);
  }
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

describe('bankroll-preserving game restart', () => {
  it('starts a fresh game at hand one without resetting winnings', () => {
    const game = gameWithPlayers(2);
    startHand(game, () => 0.27);
    act(game, game.currentActor, { type: ACTIONS.FOLD });
    const wonStacks = game.players.map((player) => player.stack);

    startNewGame(game, () => 0.41);

    assert.equal(game.handNumber, 1);
    assert.equal(game.dealerIndex, 0);
    assert.deepEqual(game.players.map((player) => player.stack), [wonStacks[0] - 10, wonStacks[1] - 20]);
    assertChipBacked(game);
  });

  it('does not reset game metadata when a new game cannot start', () => {
    const game = gameWithPlayers(2);
    game.handNumber = 7;
    game.dealerIndex = 1;
    game.result = { text: 'Previous winner' };
    game.players[1].connected = false;

    assert.throws(() => startNewGame(game, () => 0.4), /At least two/);
    assert.equal(game.handNumber, 7);
    assert.equal(game.dealerIndex, 1);
    assert.deepEqual(game.result, { text: 'Previous winner' });
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

describe('host table setup', () => {
  it('changes every seated player to the host starting stack before the first hand', () => {
    const game = gameWithPlayers(3);
    setStartingStack(game, 2500);
    assert.equal(game.startingStack, 2500);
    for (const player of game.players) {
      assert.equal(player.stack, 2500);
      assert.equal(chipRackValue(player.chips), 2500);
    }
  });

  it('rejects unsafe stacks and changes after play begins', () => {
    const game = gameWithPlayers(2);
    assert.throws(() => setStartingStack(game, 99), /between 100 and 100,000/);
    startHand(game, () => 0.41);
    assert.throws(() => setStartingStack(game, 2000), /before the first hand/);
  });
});

describe('betting flow', () => {
  it('moves from preflop to flop after every live player matches the bet', () => {
    const game = gameWithPlayers(3);
    startHand(game, () => 0.19);
    assert.equal(publicState(game, game.players[0].id).tablePot, 0);
    while (game.phase === 'preflop') {
      const player = game.players.find((p) => p.id === game.currentActor);
      const toCall = game.currentBet - player.bet;
      act(game, player.id, toCall === 0 ? { type: ACTIONS.CHECK } : { type: ACTIONS.CALL });
    }
    assert.equal(game.phase, 'flop');
    assert.equal(game.community.length, 3);
    assert.equal(publicState(game, game.players[0].id).tablePot, game.pot);
    assertChipBacked(game);
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
    assertChipBacked(game);
  });

  it('rejects actions from a player whose turn it is not', () => {
    const game = gameWithPlayers(3);
    startHand(game, () => 0.61);
    const wrong = game.players.find((p) => p.id !== game.currentActor);
    assert.throws(() => act(game, wrong.id, { type: ACTIONS.FOLD }), /turn/i);
  });
});

describe('chip-backed betting', () => {
  it('keeps each chip rack equal to the authoritative stack while betting', () => {
    const game = gameWithPlayers(3);
    startHand(game, () => 0.31);
    assertChipBacked(game);

    const actor = game.players.find((player) => player.id === game.currentActor);
    const toCall = game.currentBet - actor.bet;
    act(game, actor.id, toCall ? { type: ACTIONS.CALL } : { type: ACTIONS.CHECK });
    assertChipBacked(game);
  });

  it('lets a player make value-preserving change and publishes the rack', () => {
    const game = gameWithPlayers(3);
    startHand(game, () => 0.31);
    const player = game.players[0];
    exchangePlayerChip(game, player.id, 500);
    assert.equal(player.chips[500], 1);
    assert.equal(player.chips[100], 5);
    assert.equal(chipRackValue(player.chips), player.stack);
    assert.deepEqual(publicState(game, player.id).players[0].chips, player.chips);
  });
});
