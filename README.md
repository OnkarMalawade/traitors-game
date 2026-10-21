# TRAITORS — Trust No One

Next.js party game with Supabase-backed anonymous player sessions, live lobby roster, invite codes, room capacity enforcement, private role retrieval, and server-side room/game setup.

## Before you deploy

This project needs a Supabase project. The browser key is a **publishable/anon key**, not a service-role key. Never put a service-role key in a `NEXT_PUBLIC_` variable.

### 1. Configure Supabase

1. Open your Supabase project and go to **SQL Editor**.
2. Run the full script in `supabase/setup.sql`.
3. Go to **Authentication → Sign In / Providers** and enable **Anonymous Sign-Ins**. Players do not need to fill in a login form; Supabase creates a private anonymous session for their browser.
4. Confirm Realtime is enabled for the project. The SQL script adds the player and room tables to `supabase_realtime` where supported.

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

This is a multiplayer starter, not yet a fully hardened commercial game. The discussion timer and some screen transitions are client-rendered; voting does not yet provide a full public vote tally/revote/tie flow. Test the SQL script in a fresh Supabase project before inviting players. Add rate limiting, room cleanup, abuse controls, production monitoring, and a security review before scaling. Do not expose a service-role key in the frontend.
