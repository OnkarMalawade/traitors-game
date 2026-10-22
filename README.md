# TRAITORS — Trust No One

Next.js party game with Supabase-backed anonymous player sessions, live lobby roster, invite codes, room capacity enforcement, private role retrieval, and server-side room/game setup.

## Before you deploy

This project needs a Supabase project. The browser key is a **publishable/anon key**, not a service-role key. Never put a service-role key in a `NEXT_PUBLIC_` variable.

### 1. Configure Supabase

1. Open your Supabase project and go to **SQL Editor**.
2. Run the full script in `supabase/setup.sql`.
3. Go to **Authentication → Sign In / Providers** and enable **Anonymous Sign-Ins**. Players do not need to fill in a login form; Supabase creates a private anonymous session for their browser.
4. Confirm Realtime is enabled for the project. The SQL script adds the player, room, and chat-message tables to `supabase_realtime` where supported.

### 2. Configure environment variables

Create `.env.local` from `.env.example` and fill in your project's values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Do not commit `.env.local` or share private service-role keys.

### 3. Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in two or more browser sessions to test creating and joining a room.

### 4. Deploy to Vercel

1. Push this folder to GitHub and import it at https://vercel.com/new.
2. In Vercel → Project → Settings → Environment Variables, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for Preview and Production.
3. Redeploy after adding the variables.
4. Test with at least four separate browser sessions/devices.

## What's connected

- Real room creation through a Supabase RPC.
- Anonymous session per browser, so no visible registration form is needed.
- Server-side checks for player name, room capacity (4–20), allowed duration/category, invite expiry, and host-only game start.
- Real joins and roster updates across devices (Realtime + periodic refresh fallback).
- Random traitor selection and private role/word lookup via an RPC; secret word and traitor ID are not exposed by the lobby-state RPC.
- Vote submission and guarded reveal RPC.

## MVP limitations

This is a multiplayer starter, not yet a fully hardened commercial game. The discussion timer and some screen transitions are client-rendered; voting does not yet provide a full public vote tally/revote/tie flow. Run the updated `supabase/setup.sql` in your Supabase SQL Editor before testing; if this is an existing project, rerun the full script so the chat table and RPC functions are added. Add rate limiting, room cleanup, abuse controls, production monitoring, and a security review before scaling. Do not expose a service-role key in the frontend.

## Live chat mode

During the discussion phase, players can switch between **Live chat** and **Discussion tips**. Chat uses Supabase Realtime Postgres Changes, scoped to the room UUID. Messages show the sender name, distinct avatar color, timestamp, and a separate style for your own messages. The interface is responsive for mobile and desktop.

- Chat messages are stored in `traitor_chat_messages` and delivered live through Supabase Realtime Postgres Changes. The sender identity and display name are derived server-side from the authenticated room member.
- Each room retains only the latest 150 messages in the database and UI/history RPC; older messages are pruned automatically. Messages are available to room members who reconnect while the lobby still exists.
- When the host chooses **Destroy lobby**, the room is deleted and PostgreSQL `ON DELETE CASCADE` deletes its players, votes, and chat messages. The app asks for confirmation first. Non-host players can leave without deleting the shared lobby.
- Minimum players to start: **4**. Test with at least four separate browser sessions/devices.
- This is not an end-to-end encrypted messaging system or a moderated chat service. Do not use it for sensitive messages.

## Refresh persistence

- **Refresh-safe lobby session:** a 400-day, SameSite=Lax cookie stores only the room UUID and player UUID. On reload, the app validates the saved player against the Supabase room-membership RPC, restores the room roster/configuration, reloads chat history, and resumes the correct game phase using the server-side phase end time. The cookie is cleared when the player intentionally exits or the room/membership no longer exists. Supabase's anonymous auth identity remains managed separately by the Supabase client; clearing browser storage can invalidate that identity.
