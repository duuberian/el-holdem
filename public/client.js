const socket = window.io();
const $ = (selector) => document.querySelector(selector);
const welcome = $('#welcome');
const gameScreen = $('#game');
const form = $('#join-form');
const nameInput = $('#name');
const roomInput = $('#room');
const errorBox = $('#form-error');
const lobby = $('#lobby');
const controls = $('#controls');
const reactionTray = $('#reaction-tray');
const toast = $('#toast');

let snapshot = null;
let activeCode = '';
let reconnecting = false;
let partyMode = 'join';
let raiseBounds = null;
let stagedChips = {};
let provisionalRack = null;
let raiseInvoker = null;
let actionPending = false;
let toastTimer;

const CHIP_DENOMINATIONS = [500, 100, 20, 10, 5, 1];
const CHIP_CLASS = { 1: 'white', 5: 'red', 10: 'blue', 20: 'green', 100: 'black', 500: 'purple' };

const queryRoom = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
if (queryRoom) roomInput.value = queryRoom;
nameInput.value = localStorage.getItem('el-holdem:name') ?? '';

function showToast(message, timeout = 2200) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove('hidden');
  toastTimer = setTimeout(() => toast.classList.add('hidden'), timeout);
}

function setBusy(busy) {
  $('#party-button').disabled = busy;
}

function saveSession(code, token, name) {
  activeCode = code;
  localStorage.setItem('el-holdem:name', name);
  localStorage.setItem(`el-holdem:token:${code}`, token);
  history.replaceState(null, '', `/?room=${code}`);
}

function enterGame() {
  welcome.classList.add('hidden');
  gameScreen.classList.remove('hidden');
}

function submitJoin(code, name, automatic = false) {
  if (!code) {
    if (!automatic) errorBox.textContent = 'Enter a room code.';
    return;
  }
  setBusy(true);
  const token = localStorage.getItem(`el-holdem:token:${code}`);
  socket.emit('join-room', { code, name, token }, (reply) => {
    setBusy(false);
    reconnecting = false;
    if (!reply.ok) {
      if (!automatic) errorBox.textContent = reply.error;
      else showToast(reply.error);
      return;
    }
    saveSession(reply.code, reply.token, name);
    enterGame();
  });
}

function setPartyMode(mode) {
  partyMode = mode;
  const joining = mode === 'join';
  $('#mode-join').classList.toggle('active', joining);
  $('#mode-host').classList.toggle('active', !joining);
  $('#room-field').classList.toggle('hidden', !joining);
  $('#starting-stack-field').classList.toggle('hidden', joining);
  $('#party-button').textContent = joining ? 'Join party' : 'Create party';
  errorBox.textContent = '';
}

$('#mode-join').addEventListener('click', () => setPartyMode('join'));
$('#mode-host').addEventListener('click', () => setPartyMode('host'));

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  errorBox.textContent = '';
  if (!name) {
    errorBox.textContent = 'Enter your name first.';
    nameInput.focus();
    return;
  }
  if (partyMode === 'join') {
    submitJoin(roomInput.value.trim().toUpperCase(), name);
    return;
  }
  setBusy(true);
  socket.emit('create-room', { name, startingStack: Number($('#starting-stack').value) }, (reply) => {
    setBusy(false);
    if (!reply.ok) {
      errorBox.textContent = reply.error;
      return;
    }
    saveSession(reply.code, reply.token, name);
    enterGame();
  });
});

socket.on('connect', () => {
  $('#connection').classList.remove('offline');
  $('#connection span').textContent = 'Live';
  if (activeCode && !reconnecting) {
    reconnecting = true;
    submitJoin(activeCode, localStorage.getItem('el-holdem:name') ?? 'Player', true);
  }
});

socket.on('disconnect', () => {
  $('#connection').classList.add('offline');
  $('#connection span').textContent = 'Reconnecting';
});

function cardElement(code, back = false) {
  const card = document.createElement('div');
  card.className = back ? 'card back' : 'card';
  if (back) return card;
  const suitMap = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const suit = code.at(-1);
  const symbol = suitMap[suit] ?? suit;
  if (suit === 'h' || suit === 'd') card.classList.add('red');

  for (const position of ['top', 'bottom']) {
    const corner = document.createElement('span');
    corner.className = `card-corner card-${position}`;
    const rank = document.createElement('b');
    rank.textContent = code.slice(0, -1);
    const small = document.createElement('small');
    small.textContent = symbol;
    corner.append(rank, small);
    card.append(corner);
  }

  const center = document.createElement('span');
  center.className = 'card-center';
  center.textContent = symbol;
  card.append(center);
  return card;
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

function pokerChip(denomination, count, compact = false) {
  const chip = document.createElement('span');
  chip.className = `poker-chip chip-${CHIP_CLASS[denomination]}${compact ? ' compact' : ''}`;
  chip.textContent = denomination.toLocaleString();
  chip.dataset.denomination = denomination;
  if (count !== undefined) {
    const tally = document.createElement('span');
    tally.className = 'chip-count';
    tally.textContent = `×${count}`;
    chip.append(tally);
  }
  return chip;
}

function chipBreakdown(amount, maxTypes = CHIP_DENOMINATIONS.length) {
  let remaining = Math.max(0, Math.floor(Number(amount) || 0));
  const chips = [];
  for (const denomination of CHIP_DENOMINATIONS) {
    const count = Math.floor(remaining / denomination);
    if (count) {
      chips.push({ denomination, count });
      remaining -= count * denomination;
    }
  }
  return chips.slice(0, maxTypes);
}

function chipPile(denomination, count, interactive = false) {
  const pile = document.createElement(interactive ? 'button' : 'span');
  pile.className = 'chip-pile';
  pile.dataset.denomination = denomination;
  pile.type = interactive ? 'button' : undefined;
  const visible = Math.min(count, 4);
  pile.style.setProperty('--pile-count-level', Math.max(0, visible - 1));
  for (let level = 0; level < visible; level += 1) {
    const chip = pokerChip(denomination, undefined, true);
    chip.classList.add('pile-chip');
    if (level === visible - 1) chip.classList.add('pile-top');
    chip.style.setProperty('--pile-level', level);
    pile.append(chip);
  }
  const tally = document.createElement('span');
  tally.className = 'pile-count';
  tally.textContent = `×${count}`;
  pile.append(tally);
  return pile;
}

function stagedTotal() {
  return CHIP_DENOMINATIONS.reduce((total, denomination) => total + denomination * (stagedChips[denomination] ?? 0), 0);
}

function resetStagedChips() {
  const self = snapshot?.state.players.find((player) => player.id === snapshot.selfId);
  stagedChips = Object.fromEntries(CHIP_DENOMINATIONS.map((denomination) => [denomination, 0]));
  provisionalRack = Object.fromEntries(CHIP_DENOMINATIONS.map((denomination) => [denomination, self?.chips?.[denomination] ?? 0]));
}

function makeChipAvailable(denomination) {
  const targetIndex = CHIP_DENOMINATIONS.indexOf(denomination);
  if (targetIndex < 0 || !provisionalRack) return false;
  while ((provisionalRack[denomination] ?? 0) === 0) {
    let sourceIndex = -1;
    for (let index = targetIndex - 1; index >= 0; index -= 1) {
      if ((provisionalRack[CHIP_DENOMINATIONS[index]] ?? 0) > 0) {
        sourceIndex = index;
        break;
      }
    }
    if (sourceIndex < 0) return false;
    const source = CHIP_DENOMINATIONS[sourceIndex];
    const next = CHIP_DENOMINATIONS[sourceIndex + 1];
    provisionalRack[source] -= 1;
    provisionalRack[next] = (provisionalRack[next] ?? 0) + source / next;
  }
  return true;
}

function addStagedChip(denomination) {
  const self = snapshot?.state.players.find((player) => player.id === snapshot.selfId);
  if (!self || stagedTotal() + denomination > self.stack || !makeChipAvailable(denomination)) return;
  provisionalRack[denomination] -= 1;
  stagedChips[denomination] += 1;
  renderStagedSelection();
}

function removeStagedChip(denomination) {
  if (!stagedChips[denomination]) return;
  stagedChips[denomination] -= 1;
  provisionalRack[denomination] += 1;
  renderStagedSelection();
}


function renderChipBank() {
  const self = snapshot?.state.players.find((player) => player.id === snapshot.selfId);
  if (!self) return;
  $('#chip-bank-total').textContent = self.stack.toLocaleString();
  const rack = $('#chip-bank-rack');
  rack.replaceChildren();
  for (const denomination of CHIP_DENOMINATIONS) {
    const count = self.chips?.[denomination] ?? 0;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.chipBank = denomination;
    button.setAttribute('aria-label', denomination === 1 ? 'Smallest chip' : `Change one ${denomination} chip`);
    button.disabled = denomination === 1 || count === 0;
    button.append(pokerChip(denomination, count));
    button.addEventListener('click', () => {
      button.disabled = true;
      socket.emit('exchange-chip', { denomination }, (reply) => {
        if (!reply.ok) {
          showToast(reply.error);
          button.disabled = false;
        }
      });
    });
    rack.append(button);
  }
}

function renderRaiseChips() {
  const rack = $('#raise-chips');
  rack.replaceChildren();
  const self = snapshot?.state.players.find((player) => player.id === snapshot.selfId);
  if (!self || !provisionalRack) return;
  const remainingValue = CHIP_DENOMINATIONS.reduce((total, denomination) => total + denomination * (provisionalRack[denomination] ?? 0), 0);
  for (const denomination of [...CHIP_DENOMINATIONS].reverse()) {
    const count = provisionalRack[denomination] ?? 0;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `Add ${denomination} chip`);
    button.disabled = denomination > remainingValue || stagedTotal() + denomination > self.stack;
    button.append(pokerChip(denomination, count, true));
    button.addEventListener('click', () => addStagedChip(denomination));
    rack.append(button);
  }
}

function renderStagedSelection() {
  const piles = $('#staged-piles');
  piles.replaceChildren();
  for (const denomination of CHIP_DENOMINATIONS) {
    const count = stagedChips[denomination] ?? 0;
    if (!count) continue;
    const pile = chipPile(denomination, count, true);
    pile.setAttribute('aria-label', `Remove one ${denomination} chip`);
    pile.addEventListener('click', () => removeStagedChip(denomination));
    piles.append(pile);
  }
  const self = snapshot?.state.players.find((player) => player.id === snapshot.selfId);
  const total = stagedTotal();
  const target = (self?.bet ?? 0) + total;
  $('#staged-total').textContent = total.toLocaleString();
  $('#staged-target').textContent = target.toLocaleString();
  const validRaise = Boolean(raiseBounds && total > 0 && target > raiseBounds.currentBet
    && target <= raiseBounds.max && (target >= raiseBounds.min || target === raiseBounds.max));
  $('#raise-confirm').disabled = !validRaise || actionPending;
  const actions = snapshot?.state.legalActions ?? [];
  $('#staged-fold').classList.toggle('hidden', !actions.includes('fold'));
  $('#staged-check').classList.toggle('hidden', !actions.includes('check'));
  renderRaiseChips();
}

function playerElement(player, self, position) {
  const node = document.createElement('div');
  node.className = `player${self ? ' self' : ''}${player.folded ? ' folded' : ''}${player.connected ? '' : ' disconnected'}${snapshot.state.currentActor === player.id ? ' turn' : ''}`;
  node.dataset.playerId = player.id;
  node.style.setProperty('--x', `${position.x}%`);
  node.style.setProperty('--y', `${position.y}%`);

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = initials(player.name);
  if (player.isDealer) {
    const dealer = document.createElement('i');
    dealer.className = 'dealer';
    dealer.textContent = 'D';
    avatar.append(dealer);
  }

  const cards = document.createElement('div');
  cards.className = 'hole-cards';
  if (player.hand.length) player.hand.forEach((card) => cards.append(cardElement(card)));
  else if (player.cardCount) Array.from({ length: player.cardCount }, () => cards.append(cardElement('', true)));
  avatar.append(cards);

  const name = document.createElement('div');
  name.className = 'player-name';
  name.textContent = `${player.name}${self ? ' · YOU' : ''}`;
  const stack = document.createElement('div');
  stack.className = 'player-stack';
  stack.textContent = `STACK ${player.stack.toLocaleString()}${player.allIn ? ' · ALL IN' : ''}`;
  node.append(avatar, name, stack);
  if (player.bet > 0) {
    const bet = document.createElement('div');
    bet.className = 'bet-chip';
    for (const { denomination, count } of chipBreakdown(player.bet)) {
      bet.append(chipPile(denomination, count));
    }
    const total = document.createElement('span');
    total.className = 'bet-total';
    total.textContent = `BET ${player.bet.toLocaleString()}`;
    bet.append(total);
    node.append(bet);
  }
  return node;
}

function renderPlayers() {
  const container = $('#players');
  container.replaceChildren();
  const self = snapshot.state.players.find((player) => player.id === snapshot.selfId);
  const opponents = snapshot.state.players.filter((player) => player.id !== snapshot.selfId);
  opponents.forEach((player, index) => {
    const angle = opponents.length === 1 ? 1.5 * Math.PI : Math.PI + (Math.PI * index) / (opponents.length - 1);
    const x = 50 + 47 * Math.cos(angle);
    const y = 53 + 34 * Math.sin(angle);
    container.append(playerElement(player, false, { x, y }));
  });
  if (self) container.append(playerElement(self, true, { x: 50, y: 92 }));
}

function actionButton(label, type, className = '') {
  const button = document.createElement('button');
  button.className = `action-button ${className}`;
  button.textContent = label;
  button.addEventListener('click', () => sendAction(type));
  return button;
}

function setActionBusy(busy) {
  document.querySelectorAll('#action-buttons button, #raise-panel button').forEach((button) => {
    button.disabled = busy;
  });
}

function sendAction(type, amount) {
  if (actionPending) return;
  actionPending = true;
  setActionBusy(true);
  closeRaisePanel();
  let settled = false;
  const finish = (reply) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    actionPending = false;
    if (!reply.ok) showToast(reply.error);
    renderControls();
  };
  const timeout = setTimeout(() => finish({ ok: false, error: 'Action timed out — try again' }), 5000);
  socket.emit('action', { type, amount }, finish);
}

function openRaisePanel(invoker = document.activeElement) {
  const self = snapshot.state.players.find((player) => player.id === snapshot.selfId);
  const min = Math.min(self.bet + self.stack, snapshot.state.currentBet + snapshot.state.minRaise);
  const max = self.bet + self.stack;
  raiseBounds = { min, max, currentBet: snapshot.state.currentBet };
  resetStagedChips();
  raiseInvoker = invoker;
  gameScreen.classList.add('raise-mode');
  controls.inert = true;
  controls.classList.add('hidden');
  $('#chip-bank').classList.add('hidden');
  reactionTray.classList.add('hidden');
  $('#staged-bet').classList.remove('hidden');
  $('#raise-panel').classList.remove('hidden');
  renderStagedSelection();
  $('#raise-cancel').focus();
}

function closeRaisePanel() {
  $('#raise-panel').classList.add('hidden');
  $('#staged-bet').classList.add('hidden');
  gameScreen.classList.remove('raise-mode');
  controls.inert = false;
  stagedChips = {};
  provisionalRack = null;
  raiseBounds = null;
  if (snapshot?.state.phase !== 'waiting') controls.classList.remove('hidden');
  if (!actionPending && raiseInvoker?.isConnected) raiseInvoker.focus();
  raiseInvoker = null;
}

$('#raise-cancel').addEventListener('click', closeRaisePanel);
$('#staged-fold').addEventListener('click', () => sendAction('fold'));
$('#staged-check').addEventListener('click', () => sendAction('check'));
$('#raise-confirm').addEventListener('click', () => {
  if (!raiseBounds) return;
  const self = snapshot.state.players.find((player) => player.id === snapshot.selfId);
  const target = self.bet + stagedTotal();
  const valid = target > raiseBounds.currentBet && target <= raiseBounds.max
    && (target >= raiseBounds.min || target === raiseBounds.max);
  if (valid) sendAction('raise', target);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && raiseBounds) closeRaisePanel();
});

function renderControls() {
  const actions = snapshot.state.legalActions;
  const bar = $('#action-buttons');
  bar.replaceChildren();
  const live = snapshot.state.phase !== 'waiting';
  controls.classList.toggle('hidden', !live);
  if (!live) {
    closeRaisePanel();
    return;
  }
  if (!actions.length) {
    closeRaisePanel();
    const waiting = document.createElement('button');
    waiting.className = 'action-button';
    waiting.disabled = true;
    waiting.textContent = snapshot.state.currentActor ? 'Waiting for another player…' : 'Dealing…';
    bar.append(waiting);
    return;
  }

  if (actions.includes('fold')) bar.append(actionButton('Fold', 'fold', 'danger'));
  if (actions.includes('check')) bar.append(actionButton('Check', 'check', 'main'));
  if (actions.includes('call')) {
    const self = snapshot.state.players.find((player) => player.id === snapshot.selfId);
    const amount = Math.min(self.stack, snapshot.state.currentBet - self.bet);
    bar.append(actionButton(`Call ${amount}`, 'call', 'main', amount));
  }
  if (actions.includes('raise')) {
    const button = document.createElement('button');
    button.className = 'action-button raise-action';
    button.textContent = 'Raise…';
    button.addEventListener('click', () => openRaisePanel(button));
    bar.append(button);
    if (raiseBounds) raiseInvoker = button;
  } else {
    closeRaisePanel();
    if (actions.includes('all-in')) {
      const self = snapshot.state.players.find((player) => player.id === snapshot.selfId);
      bar.append(actionButton('All in', 'all-in', 'raise-action', self.stack));
    }
  }
  if (raiseBounds) controls.classList.add('hidden');
}

function renderLobby() {
  const waiting = snapshot.state.phase === 'waiting';
  lobby.classList.toggle('hidden', !waiting);
  if (!waiting) return;
  const enoughPlayers = snapshot.state.players.filter((player) => player.connected && player.stack > 0).length >= 2;
  $('#deal').classList.toggle('hidden', !snapshot.isHost);
  $('#deal').disabled = !enoughPlayers;
  $('#deal').textContent = snapshot.state.handNumber ? 'Play again' : 'Deal the cards';
  $('#host-note').classList.toggle('hidden', snapshot.isHost);
  const canSetStack = snapshot.isHost && snapshot.state.handNumber === 0;
  $('#host-stack-control').classList.toggle('hidden', !canSetStack);
  if (canSetStack && document.activeElement !== $('#lobby-starting-stack')) {
    $('#lobby-starting-stack').value = String(snapshot.state.startingStack);
  }
}

function render() {
  if (!snapshot) return;
  $('#room-code').textContent = snapshot.roomCode;
  const tablePot = snapshot.state.tablePot ?? snapshot.state.pot;
  $('#pot strong').textContent = tablePot.toLocaleString();
  const potChips = $('#pot-chips');
  potChips.replaceChildren(...chipBreakdown(tablePot).map(({ denomination, count }) => chipPile(denomination, count)));
  $('#phase').textContent = snapshot.state.phase === 'waiting' ? 'TABLE OPEN' : snapshot.state.phase.toUpperCase();
  const board = $('#board');
  board.replaceChildren(...snapshot.state.community.map((card) => cardElement(card)));
  renderPlayers();
  renderChipBank();
  renderLobby();
  renderControls();
  if (actionPending) setActionBusy(true);
  const result = $('#result');
  result.classList.toggle('hidden', !snapshot.state.result);
  result.textContent = snapshot.state.result?.text ?? '';
}

socket.on('state', (data) => {
  snapshot = data;
  activeCode = data.roomCode;
  enterGame();
  render();
});

$('#deal').addEventListener('click', () => socket.emit('start-hand', {}, (reply) => {
  if (!reply.ok) showToast(reply.error);
}));

$('#apply-starting-stack').addEventListener('click', () => {
  const startingStack = Number($('#lobby-starting-stack').value);
  socket.emit('set-starting-stack', { startingStack }, (reply) => {
    if (!reply.ok) showToast(reply.error);
    else showToast(`Starting stack set to ${startingStack.toLocaleString()}`);
  });
});

async function shareRoom() {
  const url = `${location.origin}/?room=${activeCode}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast('Invite link copied');
  } catch {
    if (navigator.share) await navigator.share({ title: 'Join my poker table', url });
    else showToast(`Room code: ${activeCode}`, 4000);
  }
}

$('#share').addEventListener('click', shareRoom);
$('#lobby-share').addEventListener('click', shareRoom);
$('#chip-bank-button').addEventListener('click', () => {
  closeRaisePanel();
  reactionTray.classList.add('hidden');
  $('#chip-bank').classList.toggle('hidden');
});
$('#chip-bank-close').addEventListener('click', () => $('#chip-bank').classList.add('hidden'));
$('#react-button').addEventListener('click', () => reactionTray.classList.toggle('hidden'));
reactionTray.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  socket.emit('react', { emoji: button.textContent });
  reactionTray.classList.add('hidden');
});

socket.on('reaction', ({ playerId, name, emoji }) => {
  const player = document.querySelector(`[data-player-id="${CSS.escape(playerId)}"]`);
  if (player) {
    const bubble = document.createElement('div');
    bubble.className = 'reaction-bubble';
    bubble.textContent = emoji;
    player.append(bubble);
    setTimeout(() => bubble.remove(), 1900);
  }
  showToast(`${name} reacted ${emoji}`, 1500);
});

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));

if (queryRoom && nameInput.value && localStorage.getItem(`el-holdem:token:${queryRoom}`)) {
  activeCode = queryRoom;
  submitJoin(queryRoom, nameInput.value, true);
}
