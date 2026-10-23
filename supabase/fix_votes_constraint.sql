-- QUICK FIX: Fix primary key on traitor_votes for ON CONFLICT
-- Run this in Supabase SQL Editor:

alter table public.traitor_votes add column if not exists round_number int not null default 1;
alter table public.traitor_votes add column if not exists vote_type text not null default 'eliminate';

-- Drop the old primary key constraint (which was just on room_id, voter_player_id)
alter table public.traitor_votes drop constraint if exists traitor_votes_pkey cascade;

-- Add the new composite primary key constraint matching the ON CONFLICT specification
alter table public.traitor_votes add primary key (room_id, round_number, vote_type, voter_player_id);

