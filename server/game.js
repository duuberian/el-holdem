import pokerSolver from 'pokersolver';
import { addChips, createChipRack, exchangeChip, spendChips } from './chips.js';

const { Hand } = pokerSolver;
const SUITS = ['s', 'h', 'd', 'c'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

export const ACTIONS = Object.freeze({
  FOLD: 'fold',
  CHECK: 'check',
  CALL: 'call',
  RAISE: 'raise',
  ALL_IN: 'all-in',
});

export function createDeck(random = Math.random) {
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}`));
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function createGame(options = {}) {
  return {
    players: [],
    smallBlind: options.smallBlind ?? 10,
    bigBlind: options.bigBlind ?? 20,
    phase: 'waiting',
    handNumber: 0,
    dealerIndex: -1,
    community: [],
    pot: 0,
    currentBet: 0,
    minRaise: options.bigBlind ?? 20,
    currentActor: null,
    deck: [],
    burned: [],
    pending: new Set(),
    result: null,
    showdown: false,
  };
}

function activeSeatIndexes(game) {
  return game.players
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => player.stack > 0 && player.connected !== false)
    .map(({ index }) => index);
}

function nextIndex(game, fromIndex, predicate) {
  for (let offset = 1; offset <= game.players.length; offset += 1) {
    const index = (fromIndex + offset) % game.players.length;
    if (predicate(game.players[index], index)) return index;
  }
  return -1;
}

function ensureChipRack(player) {
  if (!player.chips) player.chips = createChipRack(player.stack);
  return player.chips;
}

function creditChips(player, amount) {
  player.chips = addChips(ensureChipRack(player), amount);
  player.stack += amount;
}

function commitChips(game, player, amount) {
  const chips = Math.max(0, Math.min(player.stack, amount));
  player.chips = spendChips(ensureChipRack(player), chips);
  player.stack -= chips;
  player.bet += chips;
  player.totalBet += chips;
  game.pot += chips;
  if (player.stack === 0) player.allIn = true;
  return chips;
}

function postBlind(game, index, amount) {
  commitChips(game, game.players[index], amount);
}

export function startHand(game, random = Math.random) {
  if (game.phase !== 'waiting') throw new Error('A hand is already running');
  const seats = activeSeatIndexes(game);
  if (seats.length < 2) throw new Error('At least two connected players with chips are required');

  const nextDealer = nextIndex(
    game,
    game.dealerIndex,
    (player) => player.stack > 0 && player.connected !== false,
  );
  game.dealerIndex = nextDealer;
  game.handNumber += 1;
  game.phase = 'preflop';
  game.community = [];
  game.pot = 0;
  game.currentBet = 0;
  game.minRaise = game.bigBlind;
  game.deck = createDeck(random);
  game.burned = [];
  game.result = null;
  game.showdown = false;

  for (const player of game.players) {
    ensureChipRack(player);
    player.hand = [];
    player.bet = 0;
    player.totalBet = 0;
    player.folded = !(player.stack > 0 && player.connected !== false);
    player.allIn = false;
  }

  for (let round = 0; round < 2; round += 1) {
    let index = game.dealerIndex;
    for (let count = 0; count < seats.length; count += 1) {
      index = nextIndex(game, index, (player) => !player.folded);
      game.players[index].hand.push(game.deck.shift());
    }
  }

  const headsUp = seats.length === 2;
  const smallBlindIndex = headsUp
    ? game.dealerIndex
    : nextIndex(game, game.dealerIndex, (player) => !player.folded);
  const bigBlindIndex = nextIndex(game, smallBlindIndex, (player) => !player.folded);
  postBlind(game, smallBlindIndex, game.smallBlind);
  postBlind(game, bigBlindIndex, game.bigBlind);
  game.currentBet = Math.max(game.players[smallBlindIndex].bet, game.players[bigBlindIndex].bet);

  game.pending = new Set(
    game.players.filter((player) => !player.folded && !player.allIn).map((player) => player.id),
  );
  const firstIndex = headsUp
    ? game.dealerIndex
    : nextIndex(game, bigBlindIndex, (player) => !player.folded && !player.allIn);
  game.currentActor = firstIndex >= 0 ? game.players[firstIndex].id : null;

  if (game.pending.size <= 1) runOutBoard(game);
  return game;
}

function livePlayers(game) {
  return game.players.filter((player) => !player.folded && player.hand?.length === 2);
}

function actionable(player) {
  return !player.folded && !player.allIn && player.hand?.length === 2;
}

function finishUncontested(game, winner) {
  const won = game.pot;
  creditChips(winner, won);
  game.result = { type: 'uncontested', winners: [{ id: winner.id, amount: won }], text: `${winner.name} wins ${won}` };
  finishHand(game);
}

function finishHand(game) {
  game.phase = 'waiting';
  game.currentActor = null;
  game.currentBet = 0;
  game.pending = new Set();
  game.pot = 0;
  for (const player of game.players) player.bet = 0;
}

function chooseNextActor(game, afterPlayerId) {
  const from = game.players.findIndex((player) => player.id === afterPlayerId);
  const index = nextIndex(game, from, (player) => game.pending.has(player.id) && actionable(player));
  game.currentActor = index >= 0 ? game.players[index].id : null;
}

function dealStreet(game, phase, cardCount) {
  game.burned.push(game.deck.shift());
  game.community.push(...game.deck.splice(0, cardCount));
  game.phase = phase;
  game.currentBet = 0;
  game.minRaise = game.bigBlind;
  for (const player of game.players) player.bet = 0;
  game.pending = new Set(game.players.filter(actionable).map((player) => player.id));
  const first = nextIndex(game, game.dealerIndex, (player) => game.pending.has(player.id));
  game.currentActor = first >= 0 ? game.players[first].id : null;
}

function runOutBoard(game) {
  while (game.community.length < 5) {
    if (game.community.length === 0) dealStreet(game, 'flop', 3);
    else if (game.community.length === 3) dealStreet(game, 'turn', 1);
    else dealStreet(game, 'river', 1);
  }
  showdown(game);
}

function advanceStreet(game) {
  if (game.phase === 'preflop') dealStreet(game, 'flop', 3);
  else if (game.phase === 'flop') dealStreet(game, 'turn', 1);
  else if (game.phase === 'turn') dealStreet(game, 'river', 1);
  else if (game.phase === 'river') {
    showdown(game);
    return;
  }

  if (game.pending.size <= 1) runOutBoard(game);
}

function distributeSidePots(game) {
  const levels = [...new Set(game.players.map((player) => player.totalBet).filter(Boolean))].sort((a, b) => a - b);
  const payouts = new Map();
  let previous = 0;

  for (const level of levels) {
    const contributors = game.players.filter((player) => player.totalBet >= level);
    const amount = (level - previous) * contributors.length;
    previous = level;
    const eligible = contributors.filter((player) => !player.folded);
    if (eligible.length === 0 || amount === 0) continue;

    const solved = eligible.map((player) => ({
      player,
      hand: Hand.solve([...player.hand, ...game.community]),
    }));
    const winningHands = new Set(Hand.winners(solved.map(({ hand }) => hand)));
    const winners = solved.filter(({ hand }) => winningHands.has(hand)).map(({ player }) => player);
    const share = Math.floor(amount / winners.length);
    let remainder = amount % winners.length;
    for (const winner of winners) {
      const payout = share + (remainder > 0 ? 1 : 0);
      remainder -= remainder > 0 ? 1 : 0;
      creditChips(winner, payout);
      payouts.set(winner.id, (payouts.get(winner.id) ?? 0) + payout);
    }
  }
  return payouts;
}

function showdown(game) {
  game.showdown = true;
  const payouts = distributeSidePots(game);
  const winners = [...payouts.entries()].map(([id, amount]) => ({ id, amount }));
  const names = winners.map(({ id }) => game.players.find((player) => player.id === id)?.name).join(' & ');
  game.result = { type: 'showdown', winners, text: `${names} win${winners.length === 1 ? 's' : ''} the pot` };
  finishHand(game);
}

export function exchangePlayerChip(game, playerId, denomination) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error('Player not found');
  player.chips = exchangeChip(ensureChipRack(player), denomination);
  return player.chips;
}

export function act(game, playerId, action) {
  if (game.phase === 'waiting') throw new Error('No hand is running');
  if (game.currentActor !== playerId) throw new Error('It is not your turn');
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player || !actionable(player)) throw new Error('Player cannot act');

  const toCall = Math.max(0, game.currentBet - player.bet);
  const oldCurrentBet = game.currentBet;

  if (action.type === ACTIONS.FOLD) {
    player.folded = true;
    game.pending.delete(player.id);
  } else if (action.type === ACTIONS.CHECK) {
    if (toCall !== 0) throw new Error('Cannot check while facing a bet');
    game.pending.delete(player.id);
  } else if (action.type === ACTIONS.CALL) {
    if (toCall === 0) throw new Error('Nothing to call');
    commitChips(game, player, toCall);
    game.pending.delete(player.id);
  } else if (action.type === ACTIONS.RAISE) {
    const target = Number(action.amount);
    const maxTarget = player.bet + player.stack;
    if (!Number.isFinite(target) || target <= game.currentBet) throw new Error('Raise must exceed the current bet');
    if (target > maxTarget) throw new Error('Not enough chips');
    const raiseSize = target - game.currentBet;
    if (raiseSize < game.minRaise && target !== maxTarget) throw new Error(`Minimum raise is ${game.currentBet + game.minRaise}`);
    commitChips(game, player, target - player.bet);
    game.currentBet = player.bet;
    if (raiseSize >= game.minRaise) {
      game.minRaise = raiseSize;
      game.pending = new Set(game.players.filter((candidate) => actionable(candidate) && candidate.id !== player.id).map((candidate) => candidate.id));
    } else {
      game.pending.delete(player.id);
    }
  } else if (action.type === ACTIONS.ALL_IN) {
    commitChips(game, player, player.stack);
    if (player.bet > oldCurrentBet) {
      const raiseSize = player.bet - oldCurrentBet;
      game.currentBet = player.bet;
      if (raiseSize >= game.minRaise) {
        game.minRaise = raiseSize;
        game.pending = new Set(game.players.filter((candidate) => actionable(candidate) && candidate.id !== player.id).map((candidate) => candidate.id));
      } else game.pending.delete(player.id);
    } else game.pending.delete(player.id);
  } else {
    throw new Error('Unknown action');
  }

  const remaining = livePlayers(game);
  if (remaining.length === 1) {
    finishUncontested(game, remaining[0]);
    return game;
  }

  for (const id of [...game.pending]) {
    const candidate = game.players.find((entry) => entry.id === id);
    if (!candidate || !actionable(candidate)) game.pending.delete(id);
  }

  if (game.pending.size === 0) advanceStreet(game);
  else chooseNextActor(game, playerId);
  return game;
}

export function legalActions(game, playerId) {
  if (game.currentActor !== playerId) return [];
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) return [];
  const toCall = Math.max(0, game.currentBet - player.bet);
  return [
    ACTIONS.FOLD,
    toCall === 0 ? ACTIONS.CHECK : ACTIONS.CALL,
    ...(player.stack > toCall ? [ACTIONS.RAISE] : []),
    ACTIONS.ALL_IN,
  ];
}

export function publicState(game, viewerId) {
  return {
    smallBlind: game.smallBlind,
    bigBlind: game.bigBlind,
    phase: game.phase,
    handNumber: game.handNumber,
    dealerIndex: game.dealerIndex,
    community: [...game.community],
    pot: game.pot,
    currentBet: game.currentBet,
    minRaise: game.minRaise,
    currentActor: game.currentActor,
    result: game.result,
    players: game.players.map((player, seat) => ({
      id: player.id,
      seat,
      name: player.name,
      stack: player.stack,
      chips: { ...(player.chips ?? createChipRack(player.stack)) },
      bet: player.bet ?? 0,
      folded: player.folded ?? false,
      allIn: player.allIn ?? false,
      connected: player.connected !== false,
      isDealer: seat === game.dealerIndex,
      hand: player.id === viewerId || (game.showdown && !player.folded) ? [...(player.hand ?? [])] : [],
      cardCount: player.hand?.length ?? 0,
    })),
    legalActions: legalActions(game, viewerId),
  };
}
