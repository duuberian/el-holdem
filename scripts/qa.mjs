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
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
watch(host, 'host'); watch(guest, 'guest');

await host.goto(base, { waitUntil: 'networkidle' });
await host.screenshot({ path: new URL('landing-mobile.png', out).pathname, fullPage: true });
await host.getByRole('button', { name: 'Join a party' }).waitFor();
await host.getByRole('button', { name: 'Host a party' }).click();
await host.getByLabel('Your name').fill('Daniel');
await host.getByLabel('Starting chips per player').fill('2500');
await host.getByRole('button', { name: 'Create party' }).click();
await host.locator('#game:not(.hidden)').waitFor();
const versionBadge = await host.locator('#app-version').evaluate((badge) => ({ text: badge.textContent.trim(), rect: badge.getBoundingClientRect().toJSON(), width: innerWidth }));
if (versionBadge.text !== 'v1.1' || versionBadge.rect.top > 8 || versionBadge.rect.right < versionBadge.width - 12) throw new Error(`Version badge is not top-right: ${JSON.stringify(versionBadge)}`);
const roomCode = (await host.locator('#room-code').textContent()).trim();
const waitingLayers = await host.evaluate(() => ({ lobby: Number(getComputedStyle(document.querySelector('#lobby')).zIndex), player: Number(getComputedStyle(document.querySelector('.player.self')).zIndex) }));
if (waitingLayers.lobby <= waitingLayers.player) throw new Error(`Waiting lobby does not cover table players: ${JSON.stringify(waitingLayers)}`);
await host.screenshot({ path: new URL('lobby-waiting-mobile.png', out).pathname, fullPage: true });
if (!/^[A-Z0-9]{6}$/.test(roomCode)) throw new Error(`Unexpected room code: ${roomCode}`);

await host.getByRole('button', { name: 'Open chip bank' }).click();
await host.locator('#chip-bank:not(.hidden)').waitFor();
await host.getByRole('button', { name: 'Break one 500 chip into smaller chips' }).click();
await host.locator('[data-chip-bank="500"] .pile-count').filter({ hasText: '×4' }).waitFor();
await host.locator('[data-chip-bank="100"] .pile-count').filter({ hasText: '×5' }).waitFor();
await host.screenshot({ path: new URL('chip-bank-mobile.png', out).pathname, fullPage: true });
await host.getByRole('button', { name: 'Close chip bank' }).click();

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
for (const page of [host, guest]) {
  const rack = page.locator('#self-bankroll:not(.hidden)');
  await rack.waitFor();
  const rackTotal = Number((await rack.locator('#self-bankroll-total').textContent()).replace(/\D/g, ''));
  const stackTotal = Number((await page.locator('.player.self .player-stack').textContent()).replace(/\D/g, ''));
  if (rackTotal !== stackTotal || rackTotal <= 0) throw new Error(`Persistent personal chip total does not match stack: ${rackTotal} vs ${stackTotal}`);
  if (await rack.locator('.bankroll-piles .chip-pile').count() < 1) throw new Error('Persistent personal chip piles are missing');
  const pileBox = await rack.locator('.bankroll-piles .chip-pile').first().evaluate((pile) => pile.getBoundingClientRect().toJSON());
  if (pileBox.width > 38 || pileBox.height > 48) throw new Error(`Personal chip piles are not compact: ${JSON.stringify(pileBox)}`);
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
  const cardBefore = await page.locator('.player.self .hole-cards .card').first().boundingBox();
  const revealBox = await reveal.boundingBox();
  await reveal.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientY: revealBox.y + 10 });
  await reveal.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientY: revealBox.y + 44 });
  await page.waitForTimeout(90);
  const dragProgress = await page.locator('#game').evaluate((game) => Number(game.style.getPropertyValue('--reveal-drag')));
  if (dragProgress <= 0 || await page.locator('.player.self .card:not(.back)').count() !== 2) throw new Error('Dragging reveal down did not fluidly show both private cards');
  const cardAfter = await page.locator('.player.self .hole-cards .card').first().boundingBox();
  const revealAfter = await reveal.boundingBox();
  const revealOverlap = await page.locator('.player.self').evaluate((player) => {
    const button = player.querySelector('.reveal-cards').getBoundingClientRect();
    return [...player.querySelectorAll('.hole-cards .card')].reduce((area, card) => {
      const rect = card.getBoundingClientRect();
      return area + Math.max(0, Math.min(button.right, rect.right) - Math.max(button.left, rect.left)) * Math.max(0, Math.min(button.bottom, rect.bottom) - Math.max(button.top, rect.top));
    }, 0) / (button.width * button.height);
  });
  const cardTravel = cardAfter.y - cardBefore.y;
  const buttonTravel = revealAfter.y - revealBox.y;
  if (cardTravel < 25 || buttonTravel < 25 || Math.abs(cardTravel - buttonTravel) > 4 || cardAfter.y < 0 || cardAfter.y + cardAfter.height > 664 || revealOverlap > 0.25) throw new Error(`Cards did not follow the pull control fully in view: ${JSON.stringify({ cardBefore, cardAfter, revealBox, revealAfter, revealOverlap })}`);
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
if (await host.locator('.bet-chip .chip-pile').count() < 2) throw new Error('Posted bets were not rendered as numbered pixel chip piles');
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
await host.locator('.player.self .bet-total').filter({ hasText: 'BET 40' }).waitFor();
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
  if (phase === 'FLOP') break;
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
if ((await host.locator('#phase').textContent()).trim() !== 'FLOP') throw new Error('Betting did not progress to the flop');
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
await host.getByRole('button', { name: 'Play again' }).waitFor();
await host.getByRole('button', { name: 'Play again' }).click();
await host.locator('.player.self .hole-cards .card.back').first().waitFor();

await guest.reload({ waitUntil: 'networkidle' });
await guest.locator('#game:not(.hidden)').waitFor();
await guest.locator('.player.self').waitFor();

if (errors.length || failed.length) throw new Error(`Browser errors: ${JSON.stringify({ errors, failed })}`);

console.log(JSON.stringify({ roomCode, privacy, phase: 'FLOP', reaction: true, reconnect: true, layout, errors, failed }, null, 2));
await browser.close();
