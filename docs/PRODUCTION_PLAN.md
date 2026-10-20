# Production Plan — Game of Traitors

## 1. User journey
1. Landing page → Create Game or Join Game.
2. Host enters display name, chooses a room cap (4–20), round duration (8 or 10 minutes), and category.
3. Backend creates room and invite token; QR encodes the share URL.
4. Players open the link, enter a display name, and join before invite expiry and capacity.
5. Host starts once at least four players have joined.
6. Backend randomly selects one traitor and one secret word; roles are privately delivered.
7. Discussion phase runs for the chosen duration.
8. Voting opens; each player votes once.
9. Backend resolves the vote and reveals the traitor and word to everyone.

## 2. Proposed data model
- `rooms`: `id uuid`, `invite_hash`, `host_player_id`, `status` (`waiting`, `discussion`, `voting`, `revealed`, `closed`), `max_players`, `duration_seconds`, `category`, `created_at`, `invite_expires_at`, `phase_ends_at`, `word_id` (server-only), `traitor_player_id` (server-only).
- `players`: `id uuid`, `room_id`, `display_name`, `joined_at`, `is_host`, `is_connected`, `session_token_hash`; unique `(room_id, normalized_display_name)` as a first-pass duplicate guard.
- `words`: `id`, `category`, `word`, `active`.
- `votes`: `room_id`, `voter_player_id`, `target_player_id`, `created_at`; unique `(room_id, voter_player_id)`.
- Never expose `rooms.word_id` or `rooms.traitor_player_id` to ordinary client reads before reveal. Prefer separate public room view and server-only private role response.

## 3. Secure room join algorithm
Use a database transaction / SQL function:
- Hash and validate invite token; find room by hash.
- Reject if `now() >= invite_expires_at`, room is not waiting, or room has reached `max_players`.
- Validate normalized display name and maximum length.
- Insert player atomically.
- Return public roster and a one-time player session credential.
- Rate-limit by IP/session at the edge. Avoid leaking whether a token is valid through verbose errors.
- Host is counted as one of the room's players.

## 4. Game-state machine
`waiting → discussion → voting → revealed → closed`
- Start only if player count is between 4 and configured max.
- Start operation must be host-authorized and atomic.
- Pick the word from the chosen category and pick exactly one traitor using server-side cryptographic randomness.
- Store `phase_ends_at` on the server. Client countdown is only a display.
- On discussion timeout, move to voting. On voting timeout, tally votes.
- Tie handling: revote between tied players, then traitor wins if still tied (recommended).
- Disconnects do not immediately remove a player; allow reconnect for a grace period.

## 5. Privacy and security
- No accounts/login required, but issue a random room-scoped session token stored in a secure, same-site cookie where possible.
- Store token hashes, not raw session tokens.
- RLS denies direct access to secret columns and votes before reveal.
- Never put service-role keys in `NEXT_PUBLIC_*`.
- Use short invite TTL (10 minutes), join rate limiting, input validation, and room cleanup.
- Do not reveal the secret word through realtime events, analytics, logs, errors, or public API responses.
- Add CSP/security headers, output escaping, and basic abuse reporting.
- Decide whether names/room metadata are retained; recommended automatic deletion after a short retention window.

## 6. Vercel + Supabase deployment
1. Create a Supabase project and apply migrations.
2. Configure RLS policies and secure RPCs; test with two unrelated anonymous browser sessions.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel.
4. Keep any service-role key server-only; prefer Edge Functions or narrowly scoped database functions.
5. Configure domain, preview deployments, and production environment separately.
6. Test direct links, QR scans, expired invite, room full, host refresh, player refresh, network loss, and duplicate votes.

## 7. Testing checklist
- Unit: token expiry boundary, capacity enforcement, one-traitor invariant, vote uniqueness, tie resolution.
- Integration: two to twenty clients joining concurrently; only allowed capacity succeeds.
- Security: players cannot read other players' roles, traitor ID, or secret word before reveal.
- UX: mobile widths 320px–430px, keyboard navigation, visible focus, reduced motion, screen-reader labels.
- Reliability: reconnect during discussion, host disconnect, duplicate join requests, simultaneous start clicks.
- Load: ramp concurrent room creation and joins; observe Postgres connections, realtime channels, function latency, and error rate.

## 8. Launch criteria
- All room mutations are server-authoritative.
- Role and word secrecy tests pass.
- Capacity and expiration are atomic and race-safe.
- End-to-end tests pass on deployed preview.
- Privacy policy and retention behavior are documented.
- Load test results support the advertised capacity.
