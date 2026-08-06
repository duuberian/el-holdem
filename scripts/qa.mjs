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
await host.getByRole('button', { name: 'Create party' }).click();
await host.locator('#game:not(.hidden)').waitFor();
const roomCode = (await host.locator('#room-code').textContent()).trim();
if (!/^[A-Z0-9]{6}$/.test(roomCode)) throw new Error(`Unexpected room code: ${roomCode}`);

await host.getByRole('button', { name: 'Open chip bank' }).click();
await host.locator('#chip-bank:not(.hidden)').waitFor();
await host.getByRole('button', { name: 'Change one 500 chip' }).click();
await host.locator('[data-chip-bank="500"] .chip-count').filter({ hasText: '×1' }).waitFor();
await host.locator('[data-chip-bank="100"] .chip-count').filter({ hasText: '×5' }).waitFor();
await host.screenshot({ path: new URL('chip-bank-mobile.png', out).pathname, fullPage: true });
await host.getByRole('button', { name: 'Close chip bank' }).click();

await guest.goto(`${base}/?room=${roomCode}`, { waitUntil: 'networkidle' });
await guest.getByLabel('Your name').fill('Family');
await guest.getByRole('button', { name: 'Join party' }).click();
await guest.locator('#game:not(.hidden)').waitFor();
await host.getByText('Family', { exact: false }).first().waitFor();
await host.getByRole('button', { name: 'Deal the cards' }).click();
await host.locator('.player.self .hole-cards .card:not(.back)').first().waitFor();
await guest.locator('.player.self .hole-cards .card:not(.back)').first().waitFor();
const holeCardWidth = await host.locator('.player.self .hole-cards .card').first().evaluate((card) => card.getBoundingClientRect().width);
if (holeCardWidth < 34) throw new Error(`Hole cards are still too small: ${holeCardWidth}px`);
if (await host.locator('.player.self .card-center').count() !== 2) throw new Error('Full pixel card faces were not rendered');
if (await host.locator('.bet-chip .poker-chip').count() < 2) throw new Error('Posted bets were not rendered as numbered physical chips');

await host.getByRole('button', { name: 'Raise' }).click();
await host.locator('#raise-panel:not(.hidden)').waitFor();
for (const preset of ['Minimum', 'Half pot', 'Full pot', 'All in']) {
  await host.getByRole('button', { name: preset }).waitFor();
}
const raiseBeforeChip = Number((await host.locator('#raise-amount').textContent()).replace(/\D/g, ''));
await host.getByRole('button', { name: 'Add 20 chip' }).click();
const raiseAfterChip = Number((await host.locator('#raise-amount').textContent()).replace(/\D/g, ''));
if (raiseAfterChip !== raiseBeforeChip + 20) throw new Error('Tapping a 20 chip did not add 20 to the raise');
await host.getByRole('button', { name: 'Half pot' }).click();
await host.screenshot({ path: new URL('raise-panel-mobile.png', out).pathname, fullPage: true });
await host.getByRole('button', { name: 'Cancel raise' }).click();

const privacy = {
  hostOwnFaces: await host.locator('.player.self .card:not(.back)').count(),
  hostOpponentFaces: await host.locator('.player:not(.self) .card:not(.back)').count(),
  guestOwnFaces: await guest.locator('.player.self .card:not(.back)').count(),
  guestOpponentFaces: await guest.locator('.player:not(.self) .card:not(.back)').count(),
};
if (privacy.hostOwnFaces !== 2 || privacy.guestOwnFaces !== 2 || privacy.hostOpponentFaces || privacy.guestOpponentFaces) {
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
          await page.locator('.flying-chip').first().waitFor({ state: 'attached', timeout: 1000 });
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
if (await host.locator('#board .card').count() !== 3) throw new Error('Flop did not contain three cards');
const boardCardWidth = await host.locator('#board .card').first().evaluate((card) => card.getBoundingClientRect().width);
if (boardCardWidth < 44) throw new Error(`Community cards are still too small: ${boardCardWidth}px`);
await host.setViewportSize({ width: 350, height: 664 });
const narrowCardWidth = await host.locator('#board .card').first().evaluate((card) => card.getBoundingClientRect().width);
if (narrowCardWidth < 40) throw new Error(`Cards regress on narrow phones: ${narrowCardWidth}px`);
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
await host.locator('.player.self .hole-cards .card:not(.back)').first().waitFor();

await guest.reload({ waitUntil: 'networkidle' });
await guest.locator('#game:not(.hidden)').waitFor();
await guest.locator('.player.self').waitFor();

if (errors.length || failed.length) throw new Error(`Browser errors: ${JSON.stringify({ errors, failed })}`);

console.log(JSON.stringify({ roomCode, privacy, phase: 'FLOP', reaction: true, reconnect: true, layout, errors, failed }, null, 2));
await browser.close();
