# TRAITORS — Party Game Starter

A mobile-first, dark editorial UI for a social deduction game. Built with Next.js 14, React, TypeScript, and Lucide icons; designed to deploy on Vercel.

## Important status
This ZIP contains a polished **interactive UI prototype**, not a production multiplayer backend yet. It supports the screens and a local demo flow, but multiple devices do not share live lobby state. The join flow is a mock and the QR/link do not yet enforce server-side expiration or player limits. Do not present it as a live online game until the backend plan below is implemented.

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env.local` if you are preparing the backend integration (the UI prototype itself can run without Supabase).
3. Run:
   ```bash
   npm install
   npm run dev
   ```
4. Open http://localhost:3000.

## Deploy to Vercel
1. Upload this folder to a new GitHub repository.
2. Import the repository at https://vercel.com/new.
3. Framework preset: Next.js; build command `npm run build`.
4. Deploy. No environment variables are required for the prototype.
5. Add Supabase environment variables only after implementing and testing the realtime backend.

## Game rules represented in the UI
- Host sets a player cap from 4 to 20.
- Host selects an 8- or 10-minute round and a word category.
- All players except one should receive the same secret word.
- One random player is the traitor and sees no word.
- Players discuss clues, then vote; reveal the traitor and word.

## Recommended production architecture
- **Frontend:** Next.js on Vercel.
- **Realtime room state:** Supabase Postgres + Realtime (Broadcast/Presence or database changes).
- **Server-only game logic:** Supabase Edge Functions or Next.js Route Handlers using a server-only service role key. Never expose the service role key to the browser.
- **Room invite:** cryptographically random opaque token, store only a hash, `expires_at = created_at + interval '10 minutes'`.
- **Room membership:** transaction/SQL RPC locks room row, rejects expired/started/full rooms, and enforces one player per membership identity. Maximum is the host-configured cap (4–20).
- **Roles/word secrecy:** never broadcast the word or traitor identity in shared room state. Deliver each player's role privately after joining. The traitor receives `role='traitor'` and no word.
- **Game timer:** server timestamp is authoritative; clients render remaining time based on `ends_at`. Do not trust client timers.
- **Voting:** one vote per player; enforce with a database unique constraint; tally only when voting closes.
- **Abuse prevention:** rate-limit room creation/join, validate names and category server-side, avoid logging invite tokens, and add cleanup for expired rooms.
- **Scale:** use stateless Next.js handlers and managed Postgres/realtime. Load-test concurrent room creation, joins, disconnect/reconnect, and timer/vote transitions before advertising support for “lots of users.”

## Suggested implementation phases
1. **Phase 1 — UI & UX:** this prototype, responsive layouts, accessibility, category selection.
2. **Phase 2 — Real multiplayer:** schema, secure RPC for room creation/join, realtime lobby updates, reconnect support.
3. **Phase 3 — Gameplay integrity:** private role delivery, authoritative timer, voting, tie rules, reveal state.
4. **Phase 4 — Production hardening:** rate limits, expiry cleanup, observability, load testing, privacy and retention policy.
5. **Phase 5 — Polish:** sound toggle, animations, reconnect banners, moderation/reporting, additional word packs.

## Product decisions to settle
- The host counts as a player (recommended).
- Link expiration: ten minutes after lobby creation; once joined, the room can continue after the invite expires.
- The 4–20 player rule applies to starting a game; host can wait with fewer than four.
- The timer should be selected as 8 or 10 minutes (rather than arbitrary minutes).
- If votes tie, recommended rule: one short revote among tied players; if still tied, the traitor escapes.
- For large-scale usage, consider room capacity, rate limits, regional latency, and database connection limits before adding more features.
