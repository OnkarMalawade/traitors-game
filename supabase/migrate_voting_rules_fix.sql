-- ==============================================================================
-- MIGRATION: SPICY VOTING LOGIC & MAJORITY THRESHOLD FIX
-- Run this script in the Supabase SQL Editor:
-- 1. Ensures correct primary key on traitor_votes for ON CONFLICT
-- 2. Prevents 1-player vote resolution (auto-resolves only when all alive vote)
-- 3. Strict plurality & majority threshold: Traitor survives ties and 1-vote splits!
-- 4. Exposes voting progress (votes_cast, alive_count, has_voted) to frontend
-- ==============================================================================

-- 1. Ensure table schema & primary key
alter table public.traitor_votes add column if not exists round_number int not null default 1;
alter table public.traitor_votes add column if not exists vote_type text not null default 'eliminate';
alter table public.traitor_votes drop constraint if exists traitor_votes_pkey cascade;
alter table public.traitor_votes add primary key (room_id, round_number, vote_type, voter_player_id);

-- 2. Enhanced traitor_room_state with vote tallies & voting status
create or replace function public.traitor_room_state(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_room public.traitor_rooms;
  v_player public.traitor_players;
  v_votes_cast int := 0;
  v_shield_votes_cast int := 0;
  v_alive_count int := 0;
  v_alive_innocents int := 0;
  v_has_voted boolean := false;
  v_has_shield_voted boolean := false;
begin
  select * into v_room from public.traitor_rooms r where r.id=p_room_id;
  if not found then raise exception 'Room not found'; end if;

  select * into v_player from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user;
  if not found then raise exception 'You are not a member of this room'; end if;

  select count(*) into v_alive_count from public.traitor_players where room_id=p_room_id and is_alive=true;
  select count(*) into v_alive_innocents from public.traitor_players where room_id=p_room_id and is_alive=true and id <> v_room.traitor_player_id;

  select count(*) into v_votes_cast from public.traitor_votes
  where room_id=p_room_id and round_number=v_room.round_number and vote_type='eliminate';

  select count(*) into v_shield_votes_cast from public.traitor_votes
  where room_id=p_room_id and round_number=v_room.round_number and vote_type='shield';

  select exists(
    select 1 from public.traitor_votes
    where room_id=p_room_id and round_number=v_room.round_number and vote_type='eliminate' and voter_player_id=v_player.id
  ) into v_has_voted;

  select exists(
    select 1 from public.traitor_votes
    where room_id=p_room_id and round_number=v_room.round_number and vote_type='shield' and voter_player_id=v_player.id
  ) into v_has_shield_voted;

  return jsonb_build_object(
    'room_id',v_room.id,
    'code',v_room.code,
    'max_players',v_room.max_players,
    'duration_minutes',v_room.duration_minutes,
    'category',v_room.category,
    'game_mode',v_room.game_mode,
    'status',v_room.status,
    'round_number',v_room.round_number,
    'invite_expires_at',v_room.invite_expires_at,
    'phase_ends_at',v_room.phase_ends_at,
    'shielded_player_id',v_room.shielded_player_id,
    'last_killed_player_id',v_room.last_killed_player_id,
    'last_voted_out_player_id',v_room.last_voted_out_player_id,
    'winner',v_room.winner,
    'votes_cast',v_votes_cast,
    'shield_votes_cast',v_shield_votes_cast,
    'alive_count',v_alive_count,
    'alive_innocents',v_alive_innocents,
    'has_voted',v_has_voted,
    'has_shield_voted',v_has_shield_voted,
    'players',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',p.id,'name',p.display_name,'host',p.is_host,'alive',p.is_alive
      ) order by p.joined_at),'[]'::jsonb)
      from public.traitor_players p where p.room_id=p_room_id
    )
  );
end $$;

-- 3. Cast Vote: Only auto-resolves when ALL alive players have cast their vote
create or replace function public.traitor_cast_vote(p_room_id uuid, p_target_player_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_voter public.traitor_players;
  v_room public.traitor_rooms;
  v_alive_count int;
  v_votes_cast int;
begin
  select * into v_voter from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user;
  if not found or not v_voter.is_alive then raise exception 'Only alive players can vote'; end if;
  select * into v_room from public.traitor_rooms r where r.id=p_room_id;
  if v_room.status not in ('playing','voting') then raise exception 'Voting is not open'; end if;
  if p_target_player_id = v_voter.id then
    raise exception 'You cannot vote for yourself';
  end if;
  if not exists(select 1 from public.traitor_players p where p.id=p_target_player_id and p.room_id=p_room_id and p.is_alive) then
    raise exception 'Invalid vote target (must be an alive player)';
  end if;

  insert into public.traitor_votes(room_id,round_number,vote_type,voter_player_id,target_player_id)
  values(p_room_id,v_room.round_number,'eliminate',v_voter.id,p_target_player_id)
  on conflict(room_id,round_number,vote_type,voter_player_id)
  do update set target_player_id=excluded.target_player_id,created_at=now();

  update public.traitor_rooms set status='voting' where id=p_room_id and status='playing';

  select count(*) into v_alive_count from public.traitor_players where room_id=p_room_id and is_alive=true;
  select count(*) into v_votes_cast from public.traitor_votes where room_id=p_room_id and round_number=v_room.round_number and vote_type='eliminate';

  -- Auto-resolve only when EVERY alive player has submitted a vote
  if v_votes_cast >= v_alive_count then
    perform public.traitor_resolve_vote(p_room_id);
    return jsonb_build_object('ok',true,'resolved',true,'votes_cast',v_votes_cast,'alive_count',v_alive_count);
  end if;

  return jsonb_build_object('ok',true,'resolved',false,'votes_cast',v_votes_cast,'alive_count',v_alive_count);
end $$;

-- 4. Resolve Vote: Decisive majority required; Traitor survives ties and single-vote splits!
create or replace function public.traitor_resolve_vote(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.traitor_rooms;
  v_alive_count int;
  v_vote_count int;
  v_target uuid;
  v_top_votes int := 0;
  v_second_votes int := 0;
  v_second_target uuid;
  v_is_traitor boolean := false;
  v_alive_innocents int;
  v_is_tie boolean := false;
begin
  select * into v_room from public.traitor_rooms r where r.id=p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status not in ('playing','voting') then
    return jsonb_build_object('status',v_room.status,'last_voted_out_id',v_room.last_voted_out_player_id);
  end if;

  select count(*) into v_alive_count from public.traitor_players where room_id=p_room_id and is_alive=true;
  select count(*) into v_vote_count from public.traitor_votes where room_id=p_room_id and round_number=v_room.round_number and vote_type='eliminate';

  -- Find highest vote recipient
  select target_player_id, count(*)::int into v_target, v_top_votes
  from public.traitor_votes
  where room_id=p_room_id and round_number=v_room.round_number and vote_type='eliminate'
  group by target_player_id
  order by count(*) desc
  limit 1;

  -- Find second highest vote recipient
  select target_player_id, count(*)::int into v_second_target, v_second_votes
  from public.traitor_votes
  where room_id=p_room_id and round_number=v_room.round_number and vote_type='eliminate'
    and target_player_id <> v_target
  group by target_player_id
  order by count(*) desc
  limit 1;

  -- Stalemate conditions:
  -- 1. No votes cast at all
  if v_target is null or v_top_votes = 0 then
    v_is_tie := true;
    v_target := null;
  -- 2. Top votes are tied (e.g. 2 vs 2, or 1 vs 1 vs 1)
  elsif v_second_votes is not null and v_top_votes = v_second_votes then
    v_is_tie := true;
    v_target := null;
  -- 3. If top voted is the Traitor, the Traitor survives single-vote guesses when >=3 players are alive!
  -- Must have at least 2 votes to eliminate the Traitor
  elsif v_target = v_room.traitor_player_id and v_alive_count >= 3 and v_top_votes < 2 then
    v_is_tie := true;
    v_target := null;
  end if;

  -- CASE A: TIE / DEADLOCK (Traitor slips away in confusion!)
  if v_is_tie or v_target is null then
    if v_room.game_mode = 'basic' then
      -- In Basic mode, tie means innocents failed to uncover the traitor
      update public.traitor_rooms
      set status='revealed',
          last_voted_out_player_id=null,
          winner='traitor'
      where id=p_room_id;

      return jsonb_build_object(
        'status','revealed',
        'voted_out_id',null,
        'is_tie',true,
        'is_traitor',false,
        'winner','traitor',
        'word',v_room.secret_word,
        'traitor_player_id',v_room.traitor_player_id
      );
    else
      -- In Advanced mode: Nobody eliminated! Proceed to vote_result then Shield/Kill
      update public.traitor_rooms
      set status='vote_result',
          last_voted_out_player_id=null
      where id=p_room_id;

      return jsonb_build_object(
        'status','vote_result',
        'voted_out_id',null,
        'is_tie',true,
        'is_traitor',false,
        'alive_count',v_alive_count
      );
    end if;
  end if;

  -- CASE B: DECISIVE VOTE — Eliminate target
  update public.traitor_players set is_alive=false where id=v_target;
  v_is_traitor := (v_target = v_room.traitor_player_id);

  -- Basic mode ends immediately
  if v_room.game_mode = 'basic' then
    update public.traitor_rooms
    set status='revealed',
        last_voted_out_player_id=v_target,
        winner=case when v_is_traitor then 'innocents' else 'traitor' end
    where id=p_room_id;

    return jsonb_build_object(
      'status','revealed',
      'voted_out_id',v_target,
      'is_traitor',v_is_traitor,
      'winner',case when v_is_traitor then 'innocents' else 'traitor' end,
      'word',v_room.secret_word,
      'traitor_player_id',v_room.traitor_player_id
    );
  end if;

  -- Advanced Mode: If traitor was voted out -> INNOCENTS WIN!
  if v_is_traitor then
    update public.traitor_rooms
    set status='revealed',
        last_voted_out_player_id=v_target,
        winner='innocents'
    where id=p_room_id;

    return jsonb_build_object(
      'status','revealed',
      'voted_out_id',v_target,
      'is_traitor',true,
      'winner','innocents',
      'word',v_room.secret_word,
      'traitor_player_id',v_room.traitor_player_id
    );
  end if;

  -- Traitor survived! Check remaining alive innocents
  select count(*) into v_alive_innocents from public.traitor_players
  where room_id=p_room_id and is_alive=true and id <> v_room.traitor_player_id;

  if v_alive_innocents <= 1 then
    -- Traitor wins (1 vs 1 showdown)
    update public.traitor_rooms
    set status='revealed',
        last_voted_out_player_id=v_target,
        winner='traitor'
    where id=p_room_id;

    return jsonb_build_object(
      'status','revealed',
      'voted_out_id',v_target,
      'is_traitor',false,
      'winner','traitor',
      'word',v_room.secret_word,
      'traitor_player_id',v_room.traitor_player_id
    );
  end if;

  -- Move to vote_result screen
  select count(*) into v_alive_count from public.traitor_players where room_id=p_room_id and is_alive=true;

  update public.traitor_rooms
  set status='vote_result',
      last_voted_out_player_id=v_target
  where id=p_room_id;

  return jsonb_build_object(
    'status','vote_result',
    'voted_out_id',v_target,
    'is_traitor',false,
    'is_tie',false,
    'alive_count',v_alive_count
  );
end $$;

-- 5. Shield Vote: Auto-resolve only when all alive innocents have cast their shield vote
create or replace function public.traitor_cast_shield(p_room_id uuid, p_target_player_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_voter public.traitor_players;
  v_room public.traitor_rooms;
  v_alive_innocents int;
  v_shield_votes int;
begin
  select * into v_voter from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user;
  if not found or not v_voter.is_alive then raise exception 'Only alive players can vote for shield'; end if;
  select * into v_room from public.traitor_rooms r where r.id=p_room_id;
  if v_room.status <> 'shield' then raise exception 'Shield voting is not open'; end if;

  -- Traitor cannot vote for shield
  if v_voter.id = v_room.traitor_player_id then
    raise exception 'The traitor cannot grant shields';
  end if;

  -- Cannot shield yourself
  if p_target_player_id = v_voter.id then
    raise exception 'You cannot grant the rescue shield to yourself';
  end if;

  -- Traitor cannot be given the shield!
  if p_target_player_id = v_room.traitor_player_id then
    raise exception 'Cannot shield the traitor';
  end if;

  if not exists(select 1 from public.traitor_players p where p.id=p_target_player_id and p.room_id=p_room_id and p.is_alive) then
    raise exception 'Invalid target player';
  end if;

  insert into public.traitor_votes(room_id,round_number,vote_type,voter_player_id,target_player_id)
  values(p_room_id,v_room.round_number,'shield',v_voter.id,p_target_player_id)
  on conflict(room_id,round_number,vote_type,voter_player_id)
  do update set target_player_id=excluded.target_player_id,created_at=now();

  select count(*) into v_alive_innocents from public.traitor_players
  where room_id=p_room_id and is_alive=true and id <> v_room.traitor_player_id;

  select count(*) into v_shield_votes from public.traitor_votes
  where room_id=p_room_id and round_number=v_room.round_number and vote_type='shield';

  -- Auto-resolve when all alive innocents have cast their shield votes
  if v_shield_votes >= v_alive_innocents then
    perform public.traitor_resolve_shield(p_room_id);
    return jsonb_build_object('ok',true,'resolved',true,'shield_votes',v_shield_votes,'needed',v_alive_innocents);
  end if;

  return jsonb_build_object('ok',true,'resolved',false,'shield_votes',v_shield_votes,'needed',v_alive_innocents);
end $$;

-- 6. Resolve Shield
create or replace function public.traitor_resolve_shield(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.traitor_rooms;
  v_shielded uuid;
begin
  select * into v_room from public.traitor_rooms r where r.id=p_room_id for update;
  if v_room.status <> 'shield' then
    return jsonb_build_object('status',v_room.status,'shielded_player_id',v_room.shielded_player_id);
  end if;

  select target_player_id into v_shielded
  from public.traitor_votes
  where room_id=p_room_id and round_number=v_room.round_number and vote_type='shield'
  group by target_player_id
  order by count(*) desc, random()
  limit 1;

  update public.traitor_rooms
  set status='kill',
      shielded_player_id=v_shielded,
      phase_ends_at=now() + interval '60 seconds'
  where id=p_room_id;

  return jsonb_build_object('status','kill','shielded_player_id',v_shielded);
end $$;

