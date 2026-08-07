import { chromium, devices } from 'playwright';
import fs from 'node:fs/promises';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const out = new URL('../artifacts/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const failed = [];

function watch(page, label) {
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`${label}: ${message.text()}`); });
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
  page.on('requestfailed', (request) => failed.push(`${label}: ${request.url()} ${request.failure()?.errorText}`));
}

const mobile = devices['iPhone 13'];
const hostContext = await browser.newContext({ ...mobile });
const guestContext = await browser.newContext({ ...mobile });
const soloContext = await browser.newContext({ ...mobile });
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
const solo = await soloContext.newPage();
watch(host, 'host'); watch(guest, 'guest'); watch(solo, 'solo');

await solo.goto(base, { waitUntil: 'networkidle' });
await solo.getByLabel('Your name').fill('Solo Daniel');
await solo.getByRole('button', { name: 'Solo test table' }).click();
await solo.locator('#game:not(.hidden)').waitFor();
await solo.getByText('Test Bot 1', { exact: false }).first().waitFor();
await solo.getByText('Test Bot 2', { exact: false }).first().waitFor();
await solo.getByText('Test Bot 3', { exact: false }).first().waitFor();
if (await solo.locator('.player').count() !== 4) throw new Error('Solo test table did not create three automated opponents');
await solo.getByRole('button', { name: 'Deal the cards' }).click();
await solo.locator('.player.self .hole-cards .card.back').first().waitFor();
const betAnimation = await solo.locator('.bet-chip.bet-committed').first().evaluate((bet) => getComputedStyle(bet).animationName);
if (!betAnimation.includes('bet-slam')) throw new Error(`Newly committed chips do not use the exaggerated bet animation: ${betAnimation}`);
await solo.waitForTimeout(700);
const topBlindGeometry = await solo.locator('.player:not(.self):not(.side-player):has(.bet-chip)').evaluate((player) => ({
  stack: player.querySelector('.player-stack').getBoundingClientRect().toJSON(),
  label: player.querySelector('.player-bet-label').getBoundingClientRect().toJSON(),
  chips: player.querySelector('.bet-chip').getBoundingClientRect().toJSON(),
}));
if (topBlindGeometry.label.top < topBlindGeometry.stack.bottom - 1 || topBlindGeometry.chips.top < topBlindGeometry.stack.bottom - 1) throw new Error(`Top seat bet must sit below its stack toward the table: ${JSON.stringify(topBlindGeometry)}`);
await solo.screenshot({ path: new URL('side-bets-preflop-mobile.png', out).pathname, fullPage: true });
for (let attempt = 0; attempt < 4 && (await solo.locator('#phase').textContent()).trim().startsWith('PREFLOP'); attempt += 1) {
  const check = solo.locator('#action-buttons button:has-text("Check")').first();
  const call = solo.locator('#action-buttons button:has-text("Call")').first();
  if (await check.isVisible().catch(() => false)) await check.click();
  else if (await call.isVisible().catch(() => false)) await call.click();
  await solo.waitForTimeout(850);
}
if (!(await solo.locator('#phase').textContent()).trim().startsWith('FLOP')) throw new Error('Solo Test Bot did not automatically complete preflop play');
await solo.locator('#action-buttons button').filter({ hasText: /Check|Call/ }).first().waitFor({ timeout: 6000 });
const turnFeedback = await solo.evaluate(() => ({
  controlsClass: document.querySelector('#controls').className,
  controlsAnimation: getComputedStyle(document.querySelector('#controls')).animationName,
  label: getComputedStyle(document.querySelector('#controls'), '::before').content,
  seatAnimation: getComputedStyle(document.querySelector('.player.self .avatar')).animationName,
  nameAnimation: getComputedStyle(document.querySelector('.player.turn .player-name')).animationName,
  actingMarkers: document.querySelectorAll('.acting-marker').length,
}));
if (!turnFeedback.controlsClass.includes('your-turn') || !turnFeedback.controlsAnimation.includes('turn-controls') || !turnFeedback.label.includes('YOUR TURN') || !turnFeedback.seatAnimation.includes('turn-pulse') || !turnFeedback.nameAnimation.includes('turn-name-glow') || turnFeedback.actingMarkers) throw new Error(`Turn feedback must glow the player's name without an ACTING badge: ${JSON.stringify(turnFeedback)}`);
await solo.reload({ waitUntil: 'networkidle' });
await solo.locator('#game:not(.hidden)').waitFor({ timeout: 5000 });
await solo.locator('.player:not(.self):not(.disconnected)').filter({ hasText: 'Test Bot' }).first().waitFor({ timeout: 5000 });
if (await solo.locator('.player:not(.self):not(.disconnected)').filter({ hasText: 'Test Bot' }).count() !== 3) throw new Error('All three Solo Test Bots did not reconnect after reload');
await solo.getByRole('button', { name: 'New round' }).click();
await solo.locator('.player.self .hole-cards .card.back').first().waitFor();
for (let attempt = 0; attempt < 4 && (await solo.locator('#phase').textContent()).trim().startsWith('PREFLOP'); attempt += 1) {
  const check = solo.locator('#action-buttons button:has-text("Check")').first();
  const call = solo.locator('#action-buttons button:has-text("Call")').first();
  if (await check.isVisible().catch(() => false)) await check.click();
  else if (await call.isVisible().catch(() => false)) await call.click();
  await solo.waitForTimeout(850);
}
await solo.locator('#phase').filter({ hasText: 'FLOP' }).waitFor({ timeout: 3000 });
await solo.locator('#action-buttons button').filter({ hasText: /Check|Call/ }).first().waitFor({ timeout: 6000 });
if ((await solo.locator('#action-buttons').textContent()).includes('another player')) throw new Error('Solo mode misleadingly asks for another player after Test Bots joined');
const soloSeats = await solo.locator('.player').evaluateAll((players) => players.map((player) => {
  const rect = player.getBoundingClientRect();
  return { name: player.querySelector('.player-name')?.textContent.trim(), seat: Number(player.dataset.seat), classes: player.className, transform: player.style.transform, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
}));
const leftSoloSeat = soloSeats.find(({ classes }) => classes.includes('side-left'));
const rightSoloSeat = soloSeats.find(({ classes }) => classes.includes('side-right'));
const horizontalOpponents = soloSeats.filter(({ name, classes }) => name && !name.includes('YOU') && !classes.includes('side-player'));
if (soloSeats.length !== 4 || soloSeats.some(({ left, right, viewportWidth }) => left < 0 || right > viewportWidth)) throw new Error(`Four-player Solo seats are clipped outside the mobile viewport: ${JSON.stringify(soloSeats)}`);
if (!leftSoloSeat?.transform.includes('rotate(90deg)') || !rightSoloSeat?.transform.includes('rotate(-90deg)') || horizontalOpponents.length !== 1) throw new Error(`Left/right seats are not vertically oriented while the top seat stays horizontal: ${JSON.stringify(soloSeats)}`);
const selfSoloSeat = soloSeats.find(({ name }) => name?.includes('YOU'));
if (leftSoloSeat.seat !== (selfSoloSeat.seat + 1) % 4 || horizontalOpponents[0].seat !== (selfSoloSeat.seat + 2) % 4 || rightSoloSeat.seat !== (selfSoloSeat.seat + 3) % 4) throw new Error(`Seats do not progress clockwise from self through left, top, and right: ${JSON.stringify(soloSeats)}`);
const sideSeatGeometry = await solo.evaluate(() => [...document.querySelectorAll('.player.side-player')].map((player) => {
  const seat = player.getBoundingClientRect();
  const name = player.querySelector('.player-name');
  const nameRect = name.getBoundingClientRect();
  const probe = document.createElement('div');
  probe.className = 'bet-chip';
  probe.style.pointerEvents = 'none';
  player.append(probe);
  const bet = probe.getBoundingClientRect();
  probe.remove();
  return {
    side: player.classList.contains('side-left') ? 'left' : 'right',
    seatCenter: seat.left + seat.width / 2,
    betCenter: bet.left + bet.width / 2,
    name: name.textContent.trim(),
    nameRect: nameRect.toJSON(),
    nameDisplay: getComputedStyle(name).display,
    viewportWidth: innerWidth,
  };
}));
if (sideSeatGeometry.length !== 2 || sideSeatGeometry.some(({ side, seatCenter, betCenter }) => side === 'left' ? betCenter <= seatCenter : betCenter >= seatCenter)) throw new Error(`Side-player committed bets are not on the table-facing edge: ${JSON.stringify(sideSeatGeometry)}`);
if (sideSeatGeometry.some(({ name, nameRect, nameDisplay, viewportWidth }) => !name || nameDisplay === 'none' || nameRect.height < 50 || nameRect.width < 10 || nameRect.left < 0 || nameRect.right > viewportWidth)) throw new Error(`Side-player name is not fully visible: ${JSON.stringify(sideSeatGeometry)}`);
const topSeatOrder = await solo.locator('.player:not(.self):not(.side-player)').evaluate((player) => ({
  stack: [...player.children].findIndex((child) => child.classList.contains('player-stack')),
  bet: [...player.children].findIndex((child) => child.classList.contains('player-bet-label')),
}));
if (topSeatOrder.stack < 0 || topSeatOrder.bet < 0 || topSeatOrder.stack > topSeatOrder.bet) throw new Error(`Top player stack must appear before its table-facing bet: ${JSON.stringify(topSeatOrder)}`);
const selfChipVisibility = await solo.evaluate(() => {
  const cards = [...document.querySelectorAll('.player.self .hole-cards .card')].map((element) => element.getBoundingClientRect());
  const piles = [...document.querySelectorAll('.player.self .avatar-bankroll .chip-pile')].map((element) => element.getBoundingClientRect());
  const overlaps = piles.flatMap((pile) => cards.filter((card) => pile.left < card.right && pile.right > card.left && pile.top < card.bottom && pile.bottom > card.top));
  return { cards: cards.map((rect) => rect.toJSON()), piles: piles.map((rect) => rect.toJSON()), overlaps: overlaps.length };
});
if (!selfChipVisibility.piles.length || selfChipVisibility.overlaps) throw new Error(`Local cards obscure the physical bankroll piles: ${JSON.stringify(selfChipVisibility)}`);
const phaseGeometry = await solo.evaluate(() => {
  const phase = document.querySelector('#phase');
  const phaseRect = phase.getBoundingClientRect();
  const boardRect = document.querySelector('#board').getBoundingClientRect();
  const potRect = document.querySelector('#pot').getBoundingClientRect();
  const style = getComputedStyle(phase);
  return { text: phase.textContent.trim(), display: style.display, visibility: style.visibility, phase: phaseRect.toJSON(), board: boardRect.toJSON(), pot: potRect.toJSON() };
});
if (!phaseGeometry.text.startsWith('FLOP') || phaseGeometry.display === 'none' || phaseGeometry.visibility === 'hidden' || phaseGeometry.phase.height < 20 || phaseGeometry.phase.top < phaseGeometry.pot.bottom || phaseGeometry.phase.bottom > phaseGeometry.board.top) throw new Error(`Street/actor banner is not visible in the clear lane between pot and board: ${JSON.stringify(phaseGeometry)}`);
await solo.screenshot({ path: new URL('solo-test-mobile.png', out).pathname, fullPage: true });

await host.goto(base, { waitUntil: 'networkidle' });
await host.screenshot({ path: new URL('landing-mobile.png', out).pathname, fullPage: true });
await host.getByRole('button', { name: 'Join a party' }).waitFor();
await host.getByRole('button', { name: 'Host a party' }).click();
await host.getByLabel('Your name').fill('Daniel');
await host.getByLabel('Starting chips per player').fill('2500');
await host.getByRole('button', { name: 'Create party' }).click();
await host.locator('#game:not(.hidden)').waitFor();
const versionBadge = await host.locator('#app-version').evaluate((badge) => ({ text: badge.textContent.trim(), rect: badge.getBoundingClientRect().toJSON(), width: innerWidth }));
if (versionBadge.text !== 'v1.11' || versionBadge.rect.top > 8 || versionBadge.rect.right < versionBadge.width - 12) throw new Error(`Version badge is not top-right: ${JSON.stringify(versionBadge)}`);
const roomCode = (await host.locator('#room-code').textContent()).trim();
const waitingLayers = await host.evaluate(() => ({ lobby: Number(getComputedStyle(document.querySelector('#lobby')).zIndex), player: Number(getComputedStyle(document.querySelector('.player.self')).zIndex) }));
if (waitingLayers.lobby <= waitingLayers.player) throw new Error(`Waiting lobby does not cover table players: ${JSON.stringify(waitingLayers)}`);
await host.screenshot({ path: new URL('lobby-waiting-mobile.png', out).pathname, fullPage: true });
if (!/^[A-Z0-9]{6}$/.test(roomCode)) throw new Error(`Unexpected room code: ${roomCode}`);
if (await host.locator('#chip-bank-button').evaluate((button) => button.parentElement?.id) !== 'controls') throw new Error('Chip bank control is not beside the reaction button');

await guest.goto(`${base}/?room=${roomCode}`, { waitUntil: 'networkidle' });
await guest.getByLabel('Your name').fill('Family');
await guest.getByRole('button', { name: 'Join party' }).click();
await guest.locator('#game:not(.hidden)').waitFor();
await host.getByText('Family', { exact: false }).first().waitFor();
await host.getByRole('button', { name: 'Mute game sounds' }).click();
if (await host.getByRole('button', { name: 'Mute game sounds' }).getAttribute('aria-pressed') !== 'true') throw new Error('Sound mute state was not exposed');
await host.getByRole('button', { name: 'Mute game sounds' }).click();
if (await host.getByRole('button', { name: 'Mute game sounds' }).getAttribute('aria-pressed') !== 'false') throw new Error('Sound enable state was not exposed');
for (const page of [host, guest]) {
  const stackText = await page.locator('.player.self .player-stack').textContent();
  if (!stackText.includes('2,500')) throw new Error(`Host starting stack was not applied: ${stackText}`);
}
await host.getByLabel('Table starting chips').fill('3000');
await host.getByRole('button', { name: 'Apply starting chips' }).click();
await host.locator('.player-stack').filter({ hasText: '3,000' }).first().waitFor();
await guest.locator('.player-stack').filter({ hasText: '3,000' }).first().waitFor();
await host.getByRole('button', { name: 'Deal the cards' }).click();
await host.locator('.player.self .hole-cards .card.back').first().waitFor();
await guest.locator('.player.self .hole-cards .card.back').first().waitFor();
const bankIconVisual = await host.evaluate(() => {
  const react = document.querySelector('#react-button').getBoundingClientRect();
  const bank = document.querySelector('#chip-bank-button').getBoundingClientRect();
  const pattern = document.querySelector('#chip-bank-button .bank-pattern');
  const style = pattern ? getComputedStyle(pattern) : null;
  return { react: react.toJSON(), bank: bank.toJSON(), pattern: pattern?.getBoundingClientRect().toJSON() ?? null, background: style?.backgroundImage ?? 'none', clipPath: style?.clipPath ?? 'none' };
});
if (!bankIconVisual.pattern || Math.abs(bankIconVisual.bank.width - bankIconVisual.react.width) > 2 || Math.abs(bankIconVisual.bank.height - bankIconVisual.react.height) > 2 || bankIconVisual.background === 'none' || bankIconVisual.clipPath === 'none') throw new Error(`Chip bank does not use an emoji-sized checkered pixel icon: ${JSON.stringify(bankIconVisual)}`);
await host.getByRole('button', { name: 'Open chip bank' }).click();
await host.locator('#chip-bank:not(.hidden)').waitFor();
const bankCloseVisual = await host.getByRole('button', { name: 'Close chip bank' }).evaluate((button) => ({
  width: button.getBoundingClientRect().width,
  height: button.getBoundingClientRect().height,
  text: button.textContent.trim(),
  sharedClass: button.classList.contains('sheet-close'),
}));
if (bankCloseVisual.width < 51 || bankCloseVisual.height < 51 || bankCloseVisual.text !== '×' || !bankCloseVisual.sharedClass) throw new Error(`Chip-bank close does not use the shared Raise X control: ${JSON.stringify(bankCloseVisual)}`);
const chipBankValueBefore = await host.locator('#chip-bank-total').textContent();
await host.getByRole('button', { name: 'Break one 500 chip into smaller chips' }).click();
await host.locator('[data-chip-bank="500"] .pile-count').filter({ hasText: '×4' }).waitFor();
if (await host.locator('#chip-bank-total').textContent() !== chipBankValueBefore) throw new Error('In-hand chip exchange changed bankroll value');
await host.screenshot({ path: new URL('chip-bank-mobile.png', out).pathname, fullPage: true });
await host.getByRole('button', { name: 'Close chip bank' }).click();
for (const page of [host, guest]) {
  const rack = page.locator('#self-bankroll:not(.hidden)');
  await rack.waitFor();
  const rackTotal = Number((await rack.locator('#self-bankroll-total').textContent()).replace(/\D/g, ''));
  const stackTotal = Number((await page.locator('.player.self .player-stack').textContent()).replace(/\D/g, ''));
  if (rackTotal !== stackTotal || rackTotal <= 0) throw new Error(`Persistent personal chip total does not match stack: ${rackTotal} vs ${stackTotal}`);
  if (await rack.locator('.bankroll-piles .chip-pile').count() < 1) throw new Error('Persistent personal chip piles are missing');
  const pileBox = await rack.locator('.bankroll-piles .chip-pile').first().evaluate((pile) => pile.getBoundingClientRect().toJSON());
  if (pileBox.width > 110 || pileBox.height > 48) throw new Error(`Personal chip piles are not compact: ${JSON.stringify(pileBox)}`);
  const pileLabel = await rack.locator('.bankroll-piles .chip-pile').first().evaluate((pile) => {
    const cap = pile.querySelector('.pile-top');
    return {
      denomination: pile.dataset.denomination,
      topValue: cap.querySelector('.chip-value').textContent.trim(),
      topValueDisplay: getComputedStyle(cap.querySelector('.chip-value')).display,
      count: pile.querySelector('.pile-count').textContent.trim(),
      capHeight: cap.getBoundingClientRect().height,
      centerDisplay: getComputedStyle(cap, '::after').display,
    };
  });
  if (pileLabel.topValueDisplay === 'none' || pileLabel.topValue !== pileLabel.denomination || !/^×\d+$/.test(pileLabel.count) || pileLabel.capHeight < 11 || pileLabel.centerDisplay === 'none') throw new Error(`Chip cap is not a clean color-matched numbered face: ${JSON.stringify(pileLabel)}`);
  const rackAndToast = await page.evaluate(() => {
    const rackRect = document.querySelector('#self-bankroll').getBoundingClientRect();
    const toastRect = document.querySelector('#toast:not(.hidden)')?.getBoundingClientRect();
    return { rack: rackRect.toJSON(), toast: toastRect?.toJSON() ?? null };
  });
  if (rackAndToast.toast && rackAndToast.toast.bottom > rackAndToast.rack.top && rackAndToast.toast.top < rackAndToast.rack.bottom) {
    throw new Error(`Toast obscures the always-visible chip rack: ${JSON.stringify(rackAndToast)}`);
  }
  if (await page.locator('.player.self .card:not(.back)').count()) throw new Error('Private cards were visible without holding reveal');
  const reveal = page.getByRole('button', { name: 'Drag down to reveal your cards' });
  const revealMount = await reveal.evaluate((button) => ({
    onPlayer: Boolean(button.closest('.player.self')),
    width: button.getBoundingClientRect().width,
    height: button.getBoundingClientRect().height,
    clipPath: getComputedStyle(button).clipPath,
  }));
  if (!revealMount.onPlayer || Math.abs(revealMount.width - revealMount.height) > 1 || revealMount.clipPath === 'none') throw new Error(`Reveal control is not a pixel-round player control: ${JSON.stringify(revealMount)}`);
  const stationaryBefore = await page.evaluate(() => Object.fromEntries([
    ['brand', document.querySelector('.mini-brand')],
    ['name', document.querySelector('.player.self .player-name')],
    ['stack', document.querySelector('.player.self .player-stack')],
    ['phase', document.querySelector('#phase')],
    ['pull', document.querySelector('#reveal-cards')],
  ].map(([key, node]) => [key, node.getBoundingClientRect().toJSON()])));
  const cardBefore = await page.locator('.player.self .hole-cards .card').first().boundingBox();
  const revealBox = await reveal.boundingBox();
  await reveal.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientY: revealBox.y + 10 });
  await reveal.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientY: revealBox.y + 44 });
  await page.waitForTimeout(90);
  const dragProgress = await page.locator('#game').evaluate((game) => Number(game.style.getPropertyValue('--reveal-drag')));
  if (dragProgress <= 0 || await page.locator('.player.self .card:not(.back)').count() !== 2) throw new Error('Dragging reveal down did not fluidly show both private cards');
  const cardAfter = await page.locator('.player.self .hole-cards .card').first().boundingBox();
  const revealAfter = await reveal.boundingBox();
  const stationaryAfter = await page.evaluate(() => Object.fromEntries([
    ['brand', document.querySelector('.mini-brand')],
    ['name', document.querySelector('.player.self .player-name')],
    ['stack', document.querySelector('.player.self .player-stack')],
    ['phase', document.querySelector('#phase')],
    ['pull', document.querySelector('#reveal-cards')],
  ].map(([key, node]) => [key, node.getBoundingClientRect().toJSON()])));
  const revealOverlap = await page.locator('.player.self').evaluate((player) => {
    const button = player.querySelector('.reveal-cards').getBoundingClientRect();
    return [...player.querySelectorAll('.hole-cards .card')].reduce((area, card) => {
      const rect = card.getBoundingClientRect();
      return area + Math.max(0, Math.min(button.right, rect.right) - Math.max(button.left, rect.left)) * Math.max(0, Math.min(button.bottom, rect.bottom) - Math.max(button.top, rect.top));
    }, 0) / (button.width * button.height);
  });
  const coveredLabels = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.player.self .hole-cards .card')].map((node) => node.getBoundingClientRect());
    const targets = ['.player.self .player-name', '.player.self .player-stack', '#phase', '#board'];
    const overlaps = targets.map((selector) => {
      const node = document.querySelector(selector);
      const rect = node.getBoundingClientRect();
      const area = cards.reduce((sum, card) => sum + Math.max(0, Math.min(card.right, rect.right) - Math.max(card.left, rect.left)) * Math.max(0, Math.min(card.bottom, rect.bottom) - Math.max(card.top, rect.top)), 0);
      return { selector, area, opacity: Number(getComputedStyle(node).opacity) };
    });
    return overlaps;
  });
  const cardTravel = cardAfter.y - cardBefore.y;
  const buttonTravel = revealAfter.y - revealBox.y;
  const movedStationaryUi = Object.keys(stationaryBefore).filter((key) => Math.abs(stationaryAfter[key].x - stationaryBefore[key].x) > 1 || Math.abs(stationaryAfter[key].y - stationaryBefore[key].y) > 1);
  if (cardTravel < 25 || Math.abs(buttonTravel) > 1 || movedStationaryUi.length || cardAfter.y < 0 || cardAfter.y + cardAfter.height > 664 || revealOverlap > 0.25) throw new Error(`Reveal must move only the private cards: ${JSON.stringify({ cardBefore, cardAfter, revealBox, revealAfter, revealOverlap, movedStationaryUi, stationaryBefore, stationaryAfter })}`);
  if (coveredLabels.some((target) => target.area > 1 || target.opacity < 0.9)) throw new Error(`Revealed cards cover or hide table labels: ${JSON.stringify(coveredLabels)}`);
  if (page === host) await page.screenshot({ path: new URL('cards-reveal-mobile.png', out).pathname, fullPage: true });
  await reveal.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientY: revealBox.y + 44 });
  if (await page.locator('.player.self .card:not(.back)').count() || await page.locator('#game').evaluate((game) => Number(game.style.getPropertyValue('--reveal-drag')))) throw new Error('Private cards stayed visible after reveal was released');
  await reveal.dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'mouse', isPrimary: false, button: 2 });
  if (await page.locator('.player.self .card:not(.back)').count()) throw new Error('Secondary pointer revealed private cards');
  await reveal.focus();
  await reveal.dispatchEvent('keydown', { key: ' ', code: 'Space' });
  if (await page.locator('.player.self .card:not(.back)').count() !== 2) throw new Error('Keyboard hold did not reveal both private cards');
  await page.locator('#sound-toggle').focus();
  if (await page.locator('.player.self .card:not(.back)').count()) throw new Error('Private cards stayed visible after reveal control lost focus');
}
const holeCardWidth = await host.locator('.player.self .hole-cards .card').first().evaluate((card) => card.getBoundingClientRect().width);
if (holeCardWidth < 40) throw new Error(`Hole cards are still too small: ${holeCardWidth}px`);
if (await host.locator('.bet-chip .chip-pile').count() < 2) throw new Error('Posted bets were not rendered as pixel chip piles');
const postedBetOwnership = await host.locator('.player:has(.bet-chip)').evaluateAll((players) => players.map((player) => {
  const name = player.querySelector('.player-name');
  const amount = player.querySelector(':scope > .player-bet-label');
  const bet = player.querySelector('.bet-chip');
  const nameRect = name?.getBoundingClientRect();
  const amountRect = amount?.getBoundingClientRect();
  const amountStyle = amount ? getComputedStyle(amount) : null;
  const stackRect = player.querySelector('.player-stack')?.getBoundingClientRect();
  const betRect = bet?.getBoundingClientRect();
  const cardsRect = player.querySelector('.hole-cards')?.getBoundingClientRect();
  const overlapArea = (a, b) => (!a || !b ? 0 : Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)));
  return {
    name: name?.textContent.replace(' · YOU', '').trim() ?? '',
    aria: bet?.getAttribute('aria-label') ?? '',
    amount: amount?.textContent.trim() ?? '',
    amountUnderName: Boolean(nameRect && amountRect && amountRect.top >= nameRect.bottom - 1 && Math.abs((amountRect.left + amountRect.width / 2) - (nameRect.left + nameRect.width / 2)) < 3),
    amountPositioned: Boolean(amountRect && (player.classList.contains('self')
      ? amountRect.top >= nameRect.bottom - 1
      : amountRect.top >= stackRect.bottom - 1 && Math.abs((amountRect.left + amountRect.width / 2) - (betRect.left + betRect.width / 2)) < 3)),
    unboxed: Boolean(amountStyle && amountStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && ['0px', 'none'].includes(amountStyle.borderTopWidth)),
    floatingTotalCount: bet?.querySelectorAll('.bet-owner, .bet-total').length ?? -1,
    smallPileLabelsVisible: [...(bet?.querySelectorAll('.chip-value, .pile-count') ?? [])].some((label) => {
      const style = getComputedStyle(label);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    }),
    overlapWithCards: overlapArea(amountRect, cardsRect),
  };
}));
if (postedBetOwnership.length < 2 || postedBetOwnership.some(({ name, aria, amount, amountPositioned, unboxed, floatingTotalCount, smallPileLabelsVisible, overlapWithCards }) => !aria.includes(`${name} has bet`) || !/^BET [\d,]+$/.test(amount) || !amountPositioned || !unboxed || floatingTotalCount !== 0 || smallPileLabelsVisible || overlapWithCards > 1)) {
  throw new Error(`Bet totals are not clearly positioned on the table-facing edge without a box: ${JSON.stringify(postedBetOwnership)}`);
}
const opponentMarkers = await host.locator('.player:not(.self)').evaluateAll((players) => players.map((player) => ({
  bankroll: player.querySelector('.avatar-bankroll')?.getAttribute('aria-label') ?? '',
  piles: player.querySelectorAll('.avatar-bankroll .chip-pile').length,
  hiddenCardBacks: player.querySelectorAll('.hole-cards .card.back').length,
})));
if (!opponentMarkers.length || opponentMarkers.some(({ bankroll, piles, hiddenCardBacks }) => !/^.+ stack [\d,]+ in chips$/.test(bankroll) || piles < 1 || hiddenCardBacks !== 0)) throw new Error(`Opponent markers are not bankroll chip piles: ${JSON.stringify(opponentMarkers)}`);
await host.screenshot({ path: new URL('committed-bets-mobile.png', out).pathname, fullPage: true });
if ((await host.locator('#pot strong').textContent()).trim() !== '0') throw new Error('Street bets moved into the pot before the betting round completed');
const tableShape = await host.locator('.poker-table').evaluate((table) => {
  const rect = table.getBoundingClientRect();
  return { width: rect.width, height: rect.height, radius: getComputedStyle(table).borderRadius };
});
if (Math.abs(tableShape.width - tableShape.height) > 2 || tableShape.radius !== '0px') {
  throw new Error(`Table is not a square pixel table: ${JSON.stringify(tableShape)}`);
}

const cardsBeforeRaise = await host.locator('.player.self .hole-cards').evaluate((cards) => cards.getBoundingClientRect().top);
await host.getByRole('button', { name: 'Raise' }).click();
await host.locator('#raise-panel:not(.hidden)').waitFor();
const raiseCloseBox = await host.getByRole('button', { name: 'Cancel raise' }).boundingBox();
const raiseCloseStyle = await host.getByRole('button', { name: 'Cancel raise' }).evaluate((button) => {
  const style = getComputedStyle(button);
  return [style.width, style.height, style.backgroundColor, style.borderColor, style.borderWidth, style.color, style.fontSize, style.boxShadow];
});
await host.touchscreen.tap(raiseCloseBox.x + raiseCloseBox.width / 2, raiseCloseBox.y + raiseCloseBox.height / 2);
await host.locator('#raise-panel').waitFor({ state: 'hidden' });
if (raiseCloseBox.width < 47 || raiseCloseBox.height < 47) throw new Error(`Raise close touch target is too small: ${JSON.stringify(raiseCloseBox)}`);
await host.getByRole('button', { name: 'Raise' }).click();
await host.locator('#raise-panel:not(.hidden)').waitFor();
await host.keyboard.press('Escape');
await host.locator('#raise-panel').waitFor({ state: 'hidden' });
await host.getByRole('button', { name: 'Raise' }).click();
await host.locator('#raise-panel:not(.hidden)').waitFor();
const raiseIdentity = await host.locator('#raise-player-name').evaluate((name) => ({ text: name.textContent.trim(), visible: getComputedStyle(name).visibility !== 'hidden' && Number(getComputedStyle(name).opacity) > 0.9, rect: name.getBoundingClientRect().toJSON() }));
if (!raiseIdentity.visible || !raiseIdentity.text.toLowerCase().startsWith('daniel') || raiseIdentity.rect.width <= 0) throw new Error(`Acting player name is not visible during Raise: ${JSON.stringify(raiseIdentity)}`);
const raisePileSizes = await host.locator('#raise-chips > button').evaluateAll((buttons) => buttons.map((button) => {
  const pile = button.querySelector(':scope > .chip-pile');
  const cap = pile?.querySelector('.pile-top');
  return { hasPile: Boolean(pile), capWidth: cap?.getBoundingClientRect().width ?? 0, capHeight: cap?.getBoundingClientRect().height ?? 0 };
}));
if (raisePileSizes.length !== 6 || raisePileSizes.some((pile) => !pile.hasPile || pile.capWidth < 23 || pile.capHeight < 11)) throw new Error(`Raise controls do not use bank-sized chip piles: ${JSON.stringify(raisePileSizes)}`);
const raiseChipOrder = await host.locator('#raise-chips > button > .chip-pile').evaluateAll((piles) => piles.map((pile) => Number(pile.dataset.denomination)));
if (JSON.stringify(raiseChipOrder) !== JSON.stringify([500, 100, 20, 10, 5, 1])) throw new Error(`Raise chips are inverted: ${JSON.stringify(raiseChipOrder)}`);
if (!(await host.locator('#controls').evaluate((node) => node.classList.contains('hidden')))) throw new Error('Normal actions stayed visible while arranging a raise');
await guest.getByRole('button', { name: 'Open chip bank' }).click();
for (let exchange = 0; exchange < 5; exchange += 1) await guest.locator('[data-chip-bank="500"]').click();
const splitPile = guest.locator('#self-bankroll .chip-pile[data-denomination="100"]');
await splitPile.locator('.pile-count', { hasText: '×29' }).waitFor();
const splitPileLayout = await splitPile.evaluate((pile) => {
  const badge = pile.querySelector('.pile-count').getBoundingClientRect();
  const rect = pile.getBoundingClientRect();
  return { stacks: pile.querySelectorAll('.pile-stack').length, badgeText: pile.querySelector('.pile-count').textContent, badgeLeft: badge.left, badgeRight: badge.right, pileLeft: rect.left, pileRight: rect.right };
});
if (splitPileLayout.stacks !== 4 || splitPileLayout.badgeText !== '×29' || splitPileLayout.badgeLeft < splitPileLayout.pileLeft - 1 || splitPileLayout.badgeRight > splitPileLayout.pileRight + 1) throw new Error(`Tall chip count did not split into readable adjacent piles: ${JSON.stringify(splitPileLayout)}`);
const beforeCombineTotal = await guest.locator('#chip-bank-total').textContent();
await guest.locator('[data-chip-combine="500"]').click();
await guest.locator('#self-bankroll .chip-pile[data-denomination="100"] .pile-count', { hasText: '×24' }).waitFor();
if (await guest.locator('#chip-bank-total').textContent() !== beforeCombineTotal) throw new Error('Manual chip combine changed the bankroll value');
await guest.locator('#chip-bank-close').click();
await guest.getByRole('button', { name: 'Open chip bank' }).click();
await guest.locator('#chip-bank:not(.hidden)').waitFor();
await guest.keyboard.press('Escape');
await guest.locator('#chip-bank').waitFor({ state: 'hidden' });
await guest.getByRole('button', { name: 'Open chip bank' }).click();
const bankCloseBox = await guest.getByRole('button', { name: 'Close chip bank' }).boundingBox();
const bankCloseStyle = await guest.getByRole('button', { name: 'Close chip bank' }).evaluate((button) => {
  const style = getComputedStyle(button);
  return [style.width, style.height, style.backgroundColor, style.borderColor, style.borderWidth, style.color, style.fontSize, style.boxShadow];
});
if (JSON.stringify(bankCloseStyle) !== JSON.stringify(raiseCloseStyle)) throw new Error(`Raise and chip-bank close controls do not match: ${JSON.stringify({ raiseCloseStyle, bankCloseStyle })}`);
await guest.touchscreen.tap(bankCloseBox.x + bankCloseBox.width / 2, bankCloseBox.y + bankCloseBox.height / 2);
await guest.locator('#chip-bank').waitFor({ state: 'hidden' });
if (bankCloseBox.width < 51 || bankCloseBox.height < 51) throw new Error(`Chip bank close touch target is too small: ${JSON.stringify(bankCloseBox)}`);
await host.waitForTimeout(120);
if (!(await host.locator('#controls').evaluate((node) => node.classList.contains('hidden')))) throw new Error('A state refresh exposed normal actions over the staged raise');
await host.locator('#staged-bet:not(.hidden)').waitFor();
if ((await host.locator('#staged-total').textContent()).trim() !== '0') throw new Error('Staged bet did not start empty');
if (!(await host.getByRole('button', { name: 'Confirm staged raise' }).isDisabled())) throw new Error('Invalid empty raise could be confirmed');
await host.waitForFunction((before) => document.querySelector('.player.self .hole-cards').getBoundingClientRect().top - before >= 45, cardsBeforeRaise);
const cardsDuringRaise = await host.locator('.player.self .hole-cards').evaluate((cards) => cards.getBoundingClientRect().top);
if (cardsDuringRaise - cardsBeforeRaise < 45) throw new Error('Private cards did not move away to make room for staged chips');
await host.getByRole('button', { name: 'Add 20 chip' }).click();
await host.getByRole('button', { name: 'Add 20 chip' }).click();
await host.getByRole('button', { name: 'Add 10 chip' }).click();
if ((await host.locator('#staged-total').textContent()).trim() !== '50') throw new Error('Staged chip total was not 50');
const stagedLayers = await host.getByRole('button', { name: 'Remove one 20 chip' }).locator('.pile-chip').evaluateAll((chips) => chips.map((chip) => chip.getBoundingClientRect().top));
if (stagedLayers.length !== 2 || Math.abs(stagedLayers[0] - stagedLayers[1]) < 5) throw new Error(`Selected chips were not rendered as a physical pile: ${stagedLayers}`);
await host.screenshot({ path: new URL('raise-panel-mobile.png', out).pathname, fullPage: true });
await host.getByRole('button', { name: 'Remove one 20 chip' }).click();
if ((await host.locator('#staged-total').textContent()).trim() !== '30') throw new Error('Clicking a staged pile did not remove one chip');
if (await host.getByRole('button', { name: 'Confirm staged raise' }).isDisabled()) throw new Error('A valid staged raise could not be confirmed');
await host.setViewportSize({ width: 350, height: 664 });
for (const value of [1, 5, 100, 500]) await host.getByRole('button', { name: `Add ${value} chip` }).click();
const stagedLayout = await host.locator('#staged-bet').evaluate((stage) => {
  const bounds = stage.getBoundingClientRect();
  return [...stage.querySelectorAll('.staged-piles .chip-pile')].map((pile) => {
    const rect = pile.getBoundingClientRect();
    return { left: rect.left - bounds.left, right: rect.right - bounds.right };
  });
});
if (stagedLayout.some((pile) => pile.left < -1 || pile.right > 1)) throw new Error(`Six denomination piles overflowed the raise stage: ${JSON.stringify(stagedLayout)}`);
await host.setViewportSize({ width: 390, height: 664 });
await host.getByRole('button', { name: 'Cancel raise' }).click();
await host.locator('#controls:not(.hidden)').waitFor();
if (!(await host.locator('#staged-bet').evaluate((node) => node.classList.contains('hidden')))) throw new Error('Cancelling did not clear the staged chips');
if (!(await host.evaluate(() => document.activeElement?.textContent?.includes('Raise')))) throw new Error('Focus did not return to Raise after a state refresh and cancellation');

await host.getByRole('button', { name: 'Raise' }).click();
await host.getByRole('button', { name: 'Add 20 chip' }).click();
await host.getByRole('button', { name: 'Add 10 chip' }).click();
await host.getByRole('button', { name: 'Confirm staged raise' }).click();
await host.locator('.player.self > .player-bet-label').filter({ hasText: 'BET 40' }).waitFor();
if ((await host.locator('#pot strong').textContent()).trim() !== '0') throw new Error('Confirmed chips moved into the pot before the other player acted');

const privacy = {
  hostOwnFaces: await host.locator('.player.self .card:not(.back)').count(),
  hostOpponentFaces: await host.locator('.player:not(.self) .card:not(.back)').count(),
  guestOwnFaces: await guest.locator('.player.self .card:not(.back)').count(),
  guestOpponentFaces: await guest.locator('.player:not(.self) .card:not(.back)').count(),
};
if (privacy.hostOwnFaces || privacy.guestOwnFaces || privacy.hostOpponentFaces || privacy.guestOpponentFaces) {
  throw new Error(`Hole-card privacy failed: ${JSON.stringify(privacy)}`);
}

for (let step = 0; step < 8; step += 1) {
  const phase = (await host.locator('#phase').textContent()).trim();
  if (phase.startsWith('FLOP')) break;
  let acted = false;
  for (const page of [host, guest]) {
    for (const selector of ['button:has-text("Call")', 'button:has-text("Check")']) {
      const button = page.locator(`#action-buttons ${selector}`).first();
      if (await button.isVisible().catch(() => false)) {
        if (selector.includes('Call')) {
          const lockedImmediately = await button.evaluate((control) => {
            control.click();
            return control.disabled;
          });
          if (!lockedImmediately) throw new Error('Betting controls were not locked while the action was pending');
        } else {
          await button.click();
        }
        await page.waitForTimeout(120);
        acted = true;
        break;
      }
    }
    if (acted) break;
  }
  if (!acted) throw new Error('No legal call/check control was available');
}
if (!(await host.locator('#phase').textContent()).trim().startsWith('FLOP')) throw new Error('Betting did not progress to the flop');
if (Number((await host.locator('#pot strong').textContent()).replace(/\D/g, '')) <= 0) throw new Error('Completed street chips were not collected into the pot');
const potLayers = await host.locator('#pot-chips .chip-pile').first().locator('.pile-chip').evaluateAll((chips) => chips.map((chip) => chip.getBoundingClientRect().top));
if (potLayers.length < 2 || new Set(potLayers.map(Math.round)).size < 2) throw new Error(`Pot chips were not a visible physical pile: ${potLayers}`);
if (await host.locator('.bet-chip').count()) throw new Error('Player-side bets remained after the street completed');
if (await host.locator('#board .card').count() !== 3) throw new Error('Flop did not contain three cards');
const boardCardWidth = await host.locator('#board .card').first().evaluate((card) => card.getBoundingClientRect().width);
if (boardCardWidth < 48) throw new Error(`Community cards are still too small: ${boardCardWidth}px`);
await host.setViewportSize({ width: 350, height: 664 });
const narrowCardWidth = await host.locator('#board .card').first().evaluate((card) => card.getBoundingClientRect().width);
if (narrowCardWidth < 40) throw new Error(`Cards regress on narrow phones: ${narrowCardWidth}px`);
await host.setViewportSize({ width: 320, height: 480 });
const compactLayout = await host.evaluate(() => {
  const rack = document.querySelector('#self-bankroll').getBoundingClientRect();
  const pot = document.querySelector('#pot').getBoundingClientRect();
  const board = document.querySelector('#board').getBoundingClientRect();
  return { scrollWidth: document.documentElement.scrollWidth, width: innerWidth, rackTop: rack.top, rackBottom: rack.bottom, rackVisible: rack.width > 0 && rack.height > 0, potBottom: pot.bottom, boardTop: board.top };
});
if (compactLayout.scrollWidth > compactLayout.width || !compactLayout.rackVisible || compactLayout.rackTop < 0 || compactLayout.rackBottom > 480 || compactLayout.potBottom > compactLayout.boardTop - 2) {
  throw new Error(`Short/narrow bankroll layout failed: ${JSON.stringify(compactLayout)}`);
}
await host.setViewportSize({ width: 390, height: 664 });

await host.screenshot({ path: new URL('table-mobile-host.png', out).pathname, fullPage: true });
await guest.screenshot({ path: new URL('table-mobile-guest.png', out).pathname, fullPage: true });
const layout = await Promise.all([host, guest].map((page) => page.evaluate(() => ({
  width: innerWidth,
  height: innerHeight,
  scrollWidth: document.documentElement.scrollWidth,
  scrollHeight: document.documentElement.scrollHeight,
  controls: (() => {
    const rect = document.querySelector('#controls')?.getBoundingClientRect();
    return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
  })(),
}))));
if (layout.some((entry) => entry.scrollWidth > entry.width + 1 || entry.scrollHeight > entry.height + 1)) {
  throw new Error(`Mobile viewport overflow: ${JSON.stringify(layout)}`);
}
for (const page of [host, guest]) {
  const collision = await page.evaluate(() => {
    const stack = document.querySelector('.player.self .player-stack').getBoundingClientRect();
    const controlsRect = document.querySelector('#controls').getBoundingClientRect();
    return { stackBottom: stack.bottom, controlsTop: controlsRect.top };
  });
  if (collision.stackBottom > collision.controlsTop - 2) throw new Error(`Own stack is clipped by controls: ${JSON.stringify(collision)}`);
}

await host.getByRole('button', { name: 'Open reactions' }).click();
await host.locator('#reaction-tray button').filter({ hasText: '🔥' }).click();
await guest.getByText('Daniel reacted 🔥', { exact: true }).waitFor();

for (const page of [host, guest]) {
  const fold = page.locator('#action-buttons button:has-text("Fold")').first();
  if (await fold.isVisible().catch(() => false)) {
    await fold.click();
    break;
  }
}
await host.getByRole('button', { name: 'New round' }).waitFor();
const roundResult = await host.locator('#result').evaluate((result) => {
  const lobby = document.querySelector('#lobby');
  const style = getComputedStyle(result);
  const rect = result.getBoundingClientRect();
  const lobbyRect = lobby.getBoundingClientRect();
  const lobbyCopy = lobby.querySelector(':scope > div:not(#result)')?.getBoundingClientRect();
  return { text: result.textContent.trim(), visible: style.display !== 'none' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0, resultZ: Number(style.zIndex), lobbyZ: Number(getComputedStyle(lobby).zIndex), overlapsLobby: Math.max(0, Math.min(rect.right, lobbyRect.right) - Math.max(rect.left, lobbyRect.left)) * Math.max(0, Math.min(rect.bottom, lobbyRect.bottom) - Math.max(rect.top, lobbyRect.top)) > 0, coversLobbyCopy: lobbyCopy ? rect.bottom > lobbyCopy.top : true };
});
if (!roundResult.visible || !/(Daniel|Family) wins [\d,]+/.test(roundResult.text) || roundResult.coversLobbyCopy) throw new Error(`Round result does not clearly show who won and how much: ${JSON.stringify(roundResult)}`);
await host.screenshot({ path: new URL('round-result-mobile.png', out).pathname, fullPage: true });
await host.getByRole('button', { name: 'New game' }).waitFor();
await host.getByRole('button', { name: 'New round' }).click();
await host.locator('#result.hidden').waitFor({ state: 'attached' });
await host.locator('#phase').filter({ hasText: 'PREFLOP' }).waitFor();
await host.locator('.player.self .hole-cards .card.back').first().waitFor();
let showdownChoiceChecked = false;
for (let turn = 0; turn < 40 && await host.locator('#result').evaluate((result) => result.classList.contains('hidden')); turn += 1) {
  let acted = false;
  for (const page of [host, guest]) {
    for (const label of ['Show cards', 'Call', 'Check']) {
      const button = page.getByRole('button', { name: label, exact: false }).first();
      if (await button.isVisible().catch(() => false)) {
        if (label === 'Show cards') {
          const showdownControls = await page.locator('#controls').evaluate((controls) => ({
            labels: [...controls.querySelectorAll('#action-buttons button')].map((entry) => entry.textContent.trim()),
            heights: [...controls.querySelectorAll('#action-buttons button')].map((entry) => entry.getBoundingClientRect().height),
            reactDisplay: getComputedStyle(controls.querySelector('#react-button')).display,
            bankDisplay: getComputedStyle(controls.querySelector('#chip-bank-button')).display,
          }));
          if (showdownControls.labels.join('|') !== 'Show cards|Muck hand' || showdownControls.heights.some((height) => height < 68) || showdownControls.reactDisplay !== 'none' || showdownControls.bankDisplay !== 'none') throw new Error(`Showdown did not replace poker controls with only two large SHOW/MUCK options: ${JSON.stringify(showdownControls)}`);
          showdownChoiceChecked = true;
        }
        await button.click();
        await page.waitForTimeout(120);
        acted = true;
        break;
      }
    }
    if (acted) break;
  }
  if (!acted) throw new Error('Could not advance the second round to showdown');
}
await host.locator('#result:not(.hidden)').waitFor();
if (await host.locator('#result:not(.hidden) .winner-cards .card').count() === 0) {
  const resultDebug = await host.locator('#result').evaluate((result) => ({ text: result.textContent.trim(), html: result.innerHTML, phase: document.querySelector('#phase')?.textContent.trim() }));
  throw new Error(`Second round ended without visible showdown cards: ${JSON.stringify(resultDebug)}`);
}
const winningCards = await host.locator('#result').evaluate((result) => ({
  stage: result.querySelector('.result-stage')?.textContent.trim() ?? '',
  phase: document.querySelector('#phase')?.textContent.trim() ?? '',
  finalBoard: result.querySelectorAll('.result-board-cards .card').length,
  rows: [...result.querySelectorAll('.winner-summary')].map((row) => ({
    won: row.classList.contains('won'),
    originalLabel: row.querySelector('.winner-cards')?.getAttribute('aria-label') ?? '',
    cards: [...row.querySelectorAll('.winner-cards .card')].map((card) => ({ label: card.getAttribute('aria-label'), width: card.getBoundingClientRect().width })),
    hand: row.querySelector('.winner-hand')?.textContent.trim() ?? '',
    name: row.querySelector('.winner-name')?.textContent.trim() ?? '',
  })),
}));
if (!winningCards.stage.startsWith('RIVER') || !winningCards.phase.startsWith('RIVER') || winningCards.finalBoard !== 5 || !winningCards.rows[0]?.won || !winningCards.rows[0]?.originalLabel.includes('original hole cards')) throw new Error(`Final result does not lead with the winning original cards, street, and board: ${JSON.stringify(winningCards)}`);
if (winningCards.rows.length < 2 || winningCards.rows.some((row) => row.cards.length !== 2 || row.cards.some((card) => !card.label || card.width < 46) || !row.hand.startsWith('MADE ') || !row.name)) throw new Error(`Showdown result does not clearly show every remaining player's large cards and hand: ${JSON.stringify(winningCards)}`);
await host.screenshot({ path: new URL('showdown-result-mobile.png', out).pathname, fullPage: true });
await host.getByRole('button', { name: 'New game' }).waitFor();
await host.getByRole('button', { name: 'New game' }).click();
await host.locator('.player.self .hole-cards .card.back').first().waitFor();

const guestSeatBeforeRefresh = await guest.locator('.player.self').getAttribute('data-player-id');
const playerCountBeforeRefresh = await guest.locator('.player').count();
await guest.evaluate(() => history.replaceState(null, '', '/'));
await guest.reload({ waitUntil: 'networkidle' });
await guest.locator('#game:not(.hidden)').waitFor();
await guest.locator('.player.self').waitFor();
const guestSeatAfterRefresh = await guest.locator('.player.self').getAttribute('data-player-id');
if (guestSeatAfterRefresh !== guestSeatBeforeRefresh || await guest.locator('.player').count() !== playerCountBeforeRefresh || !await guest.locator('#welcome').evaluate((node) => node.classList.contains('hidden'))) throw new Error(`Refresh did not reclaim the same seat without duplicating/leaving: ${JSON.stringify({ guestSeatBeforeRefresh, guestSeatAfterRefresh, playerCountBeforeRefresh, after: await guest.locator('.player').count() })}`);

if (errors.length || failed.length) throw new Error(`Browser errors: ${JSON.stringify({ errors, failed })}`);

console.log(JSON.stringify({ roomCode, privacy, phase: 'FLOP', reaction: true, reconnect: true, layout, errors, failed }, null, 2));
await browser.close();
