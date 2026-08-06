# EL Holdem

A mobile-first, private Texas Hold’em table for 2–8 family members on separate devices. The Node server owns the room, shuffled deck, hidden cards, turn order, bets, side pots, and showdown; browsers only receive the state they are allowed to see.

**Play:** https://el-holdem.178.156.221.203.sslip.io

**Source:** https://github.com/duuberian/el-holdem

## Features

- Live private rooms with explicit **Host a party** / **Join a party** flows and six-character invite codes
- Server-authoritative 52-card deck; duplicate-card invariants are tested
- 2–8 players, blinds, fold/check/call/raise/all-in, community streets, side pots, and showdown hand evaluation
- Intuitive raise panel with minimum, half-pot, full-pot, and all-in presets plus final confirmation
- Original retro pixel-casino styling with chunky, readable cards and controls
- Hole cards visible only to their owner until showdown
- One-tap emoji reactions
- Mobile-first responsive table and installable PWA shell
- Reconnect token stored on each device; a reconnect reclaims the same seat
- No accounts, adverts, analytics, or real-money features

## Run locally

Requires Node.js 20+.

```bash
npm install
npm start
```

Open `http://localhost:3000`. For phones on the same hotspot/Wi-Fi, open `http://YOUR-COMPUTER-LAN-IP:3000` on each phone.

## Run with Docker

```bash
docker build -t el-holdem .
docker run --rm -p 3000:3000 el-holdem
```

For use on a train across separate mobile connections, deploy the container to any HTTPS-capable Node/container host. The server is stateless beyond process memory, so use one instance and disable autoscaling for this family MVP.

## Verify

```bash
npm test       # domain and room tests
npm run lint   # static checks
npm run qa     # Playwright two-phone live flow; requires `npx playwright install chromium`
```

The browser QA creates two isolated mobile sessions, starts a hand, verifies hole-card privacy, advances to the flop, sends a reaction, reloads/reconnects, checks viewport overflow, and fails on console/network errors. Screenshots are written to `artifacts/`.

## Important limits

- Play-money only. There are no deposits, payments, or cash-out features.
- Rooms and chip stacks live in server memory and reset when the process restarts.
- Reconnecting while it is your turn automatically folds that hand during the brief disconnect, preventing a table lock.
- The invite code is private-by-obscurity, not account-grade authentication. Share it only with people you trust.
- This is a focused family MVP, not a casino-grade audited poker platform.

## Architecture

- `server/game.js` — pure server-authoritative poker engine
- `server/rooms.js` — rooms, seats, reconnect tokens
- `server/index.js` — Express + Socket.IO transport
- `public/` — dependency-free mobile web client/PWA
- `test/` — deck, privacy, betting, and room tests
- `scripts/qa.mjs` — real two-browser mobile smoke test
