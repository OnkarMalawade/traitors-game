-- TRAITORS: live lobby + private role RPCs. Run in Supabase SQL Editor.
-- Then enable Auth > Sign In / Providers > Anonymous Sign-Ins.
create extension if not exists pgcrypto;

create table if not exists public.traitor_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_user_id uuid not null,
  host_player_id uuid,
  max_players int not null check (max_players between 3 and 20),
  duration_minutes int not null check (duration_minutes in (8,10)),
  category text not null check (category in ('Places','Brands','Anime','Football','Cricket','Games','Countries','Animals','Movies','Comics')),
  status text not null default 'lobby' check (status in ('lobby','playing','voting','revealed')),
  created_at timestamptz not null default now(),
  invite_expires_at timestamptz not null default (now() + interval '10 minutes'),
  phase_ends_at timestamptz,
  secret_word text,
  traitor_player_id uuid
);

create table if not exists public.traitor_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.traitor_rooms(id) on delete cascade,
  user_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 24),
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  unique(room_id, user_id),
  unique(room_id, id)
);

create table if not exists public.traitor_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.traitor_rooms(id) on delete cascade,
  player_id uuid not null,
  message_text text not null check (char_length(message_text) between 1 and 500),
  created_at timestamptz not null default now(),
  foreign key (room_id, player_id) references public.traitor_players(room_id, id) on delete cascade
);

create index if not exists traitor_chat_messages_room_created_idx
  on public.traitor_chat_messages(room_id, created_at);

create table if not exists public.traitor_votes (
  room_id uuid not null references public.traitor_rooms(id) on delete cascade,
  voter_player_id uuid not null,
  target_player_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(room_id, voter_player_id)
);

alter table public.traitor_rooms enable row level security;
alter table public.traitor_players enable row level security;
alter table public.traitor_votes enable row level security;
alter table public.traitor_chat_messages enable row level security;
-- Clients use the security-definer RPCs below; direct table reads/writes are deliberately closed.
revoke all on public.traitor_rooms, public.traitor_players, public.traitor_votes, public.traitor_chat_messages from anon, authenticated;
-- Realtime roster visibility is limited to players in the same room.
create or replace function public.traitor_is_room_member(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.traitor_players p where p.room_id=p_room_id and p.user_id=auth.uid())
$$;
grant execute on function public.traitor_is_room_member(uuid) to authenticated;
grant select on public.traitor_players to authenticated;
drop policy if exists traitor_players_member_select on public.traitor_players;
create policy traitor_players_member_select on public.traitor_players for select to authenticated using (public.traitor_is_room_member(room_id));

grant select on public.traitor_chat_messages to authenticated;
drop policy if exists traitor_chat_member_select on public.traitor_chat_messages;
create policy traitor_chat_member_select on public.traitor_chat_messages for select to authenticated
  using (public.traitor_is_room_member(room_id));

create or replace function public.traitor_create_room(p_name text, p_max_players int, p_duration int, p_category text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room public.traitor_rooms; v_player public.traitor_players; v_code text;
begin
 if v_user is null then raise exception 'Sign in required'; end if;
 if p_name is null or char_length(trim(p_name)) not between 1 and 24 then raise exception 'Name must be 1–24 characters'; end if;
 if p_max_players not between 3 and 20 then raise exception 'Player limit must be 3–20'; end if;
 if p_duration not in (8,10) then raise exception 'Duration must be 8 or 10 minutes'; end if;
 if p_category not in ('Places','Brands','Anime','Football','Cricket','Games','Countries','Animals','Movies','Comics') then raise exception 'Invalid category'; end if;
 v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 while exists(select 1 from public.traitor_rooms r where r.code=v_code) loop v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)); end loop;
 insert into public.traitor_rooms(code,host_user_id,max_players,duration_minutes,category) values(v_code,v_user,p_max_players,p_duration,p_category) returning * into v_room;
 insert into public.traitor_players(room_id,user_id,display_name,is_host) values(v_room.id,v_user,trim(p_name),true) returning * into v_player;
 update public.traitor_rooms set host_player_id=v_player.id where id=v_room.id;
 return jsonb_build_object('room_id',v_room.id,'code',v_room.code,'player_id',v_player.id,'players',jsonb_build_array(jsonb_build_object('id',v_player.id,'name',v_player.display_name,'host',true)),'max_players',v_room.max_players,'duration_minutes',v_room.duration_minutes,'category',v_room.category,'status',v_room.status);
end $$;

create or replace function public.traitor_join_room(p_code text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room public.traitor_rooms; v_player public.traitor_players;
begin
 if v_user is null then raise exception 'Sign in required'; end if;
 if p_name is null or char_length(trim(p_name)) not between 1 and 24 then raise exception 'Name must be 1–24 characters'; end if;
 select * into v_room from public.traitor_rooms r where r.code=upper(trim(p_code)) for update;
 if not found then raise exception 'Room code not found'; end if;
 if v_room.invite_expires_at < now() and v_room.status='lobby' then raise exception 'This invite has expired'; end if;
 if v_room.status <> 'lobby' then raise exception 'This game has already started'; end if;
 if exists(select 1 from public.traitor_players p where p.room_id=v_room.id and p.user_id=v_user) then
   select * into v_player from public.traitor_players p where p.room_id=v_room.id and p.user_id=v_user;
 else
   if (select count(*) from public.traitor_players p where p.room_id=v_room.id) >= v_room.max_players then raise exception 'Lobby is full'; end if;
   insert into public.traitor_players(room_id,user_id,display_name) values(v_room.id,v_user,trim(p_name)) returning * into v_player;
 end if;
 return jsonb_build_object('room_id',v_room.id,'code',v_room.code,'player_id',v_player.id,'max_players',v_room.max_players,'duration_minutes',v_room.duration_minutes,'category',v_room.category,'status',v_room.status);
end $$;

create or replace function public.traitor_start_game(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room public.traitor_rooms; v_count int; v_traitor uuid; v_word text; v_words text[];
begin
 select * into v_room from public.traitor_rooms r where r.id=p_room_id for update;
 if not found or v_room.host_user_id <> v_user then raise exception 'Only the host can start this game'; end if;
 if v_room.status <> 'lobby' then raise exception 'Game is not in the lobby'; end if;
 select count(*) into v_count from public.traitor_players p where p.room_id=p_room_id;
 if v_count < 3 then raise exception 'At least 3 players are required'; end if;
 case v_room.category
 when 'Places' then v_words := array['Tokyo','Eiffel Tower','Grand Canyon','Mumbai','Great Barrier Reef','Taj Mahal','New York','Mount Everest','Santorini','Colosseum'];
 when 'Brands' then v_words := array['Nike','LEGO','Apple','Coca-Cola','Netflix','Adidas','IKEA','Samsung','Spotify','Nintendo'];
 when 'Anime' then v_words := array['Naruto','One Piece','Demon Slayer','Jujutsu Kaisen','Death Note','Dragon Ball','Attack on Titan','Pokémon'];
 when 'Football' then v_words := array['Lionel Messi','Cristiano Ronaldo','Neymar Jr.','Kylian Mbappé','Erling Haaland','Sunil Chhetri'];
 when 'Cricket' then v_words := array['Virat Kohli','MS Dhoni','Rohit Sharma','Jasprit Bumrah','AB de Villiers','Sachin Tendulkar'];
 when 'Games' then v_words := array['Minecraft','Fortnite','GTA V','Among Us','Valorant','FIFA','Clash of Clans'];
 when 'Countries' then v_words := array['Japan','Brazil','India','Iceland','Canada','Egypt','Australia','Argentina'];
 when 'Animals' then v_words := array['Lion','Elephant','Dolphin','Eagle','Panda','Wolf','Shark','Penguin','Tiger','Cheetah'];
 when 'Movies' then v_words := array['Inception','Titanic','Avatar','Interstellar','The Dark Knight','Avengers','Jurassic Park','Forrest Gump','The Matrix','Gladiator'];
 when 'Comics' then v_words := array['Spider-Man','Batman','Iron Man','Superman','Wolverine','Wonder Woman','Thor','The Joker','Deadpool','Black Panther'];
 else v_words := array['Japan','Brazil','India','Iceland','Canada','Egypt','Australia','Argentina'];
 end case;
 select p.id into v_traitor from public.traitor_players p where p.room_id=p_room_id order by random() limit 1;
 v_word := v_words[1+floor(random()*array_length(v_words,1))::int];
 update public.traitor_rooms set status='playing',phase_ends_at=now() + make_interval(mins=>duration_minutes),traitor_player_id=v_traitor,secret_word=v_word where id=p_room_id;
 return jsonb_build_object('status','playing','phase_ends_at',now() + make_interval(mins=>v_room.duration_minutes));
end $$;

create or replace function public.traitor_my_role(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room public.traitor_rooms; v_player public.traitor_players;
begin
 select * into v_player from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user;
 if not found then raise exception 'You are not a member of this room'; end if;
 select * into v_room from public.traitor_rooms r where r.id=p_room_id;
 if v_room.status='lobby' then raise exception 'Game has not started yet'; end if;
 return jsonb_build_object('player_id',v_player.id,'traitor_player_id',v_room.traitor_player_id,'is_traitor',v_player.id=v_room.traitor_player_id,'word',case when v_player.id=v_room.traitor_player_id then null else v_room.secret_word end,'traitor_name',(select p.display_name from public.traitor_players p where p.id=v_room.traitor_player_id),'status',v_room.status,'phase_ends_at',v_room.phase_ends_at);
end $$;

create or replace function public.traitor_room_state(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room public.traitor_rooms;
begin
 select * into v_room from public.traitor_rooms r where r.id=p_room_id;
 if not found or not exists(select 1 from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user) then raise exception 'You are not a member of this room'; end if;
 return jsonb_build_object('room_id',v_room.id,'code',v_room.code,'max_players',v_room.max_players,'duration_minutes',v_room.duration_minutes,'category',v_room.category,'status',v_room.status,'invite_expires_at',v_room.invite_expires_at,'phase_ends_at',v_room.phase_ends_at,'players',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'host',p.is_host) order by p.joined_at),'[]'::jsonb) from public.traitor_players p where p.room_id=p_room_id));
end $$;

create or replace function public.traitor_cast_vote(p_room_id uuid, p_target_player_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_voter public.traitor_players; v_room public.traitor_rooms;
begin
 select * into v_voter from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user;
 if not found then raise exception 'You are not a member of this room'; end if;
 select * into v_room from public.traitor_rooms r where r.id=p_room_id;
 if v_room.status not in ('playing','voting') then raise exception 'Voting is not open'; end if;
 if not exists(select 1 from public.traitor_players p where p.id=p_target_player_id and p.room_id=p_room_id) then raise exception 'Invalid vote target'; end if;
 insert into public.traitor_votes(room_id,voter_player_id,target_player_id) values(p_room_id,v_voter.id,p_target_player_id) on conflict(room_id,voter_player_id) do update set target_player_id=excluded.target_player_id,created_at=now();
 update public.traitor_rooms set status='voting' where id=p_room_id and status='playing';
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.traitor_reveal(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room public.traitor_rooms; v_member boolean; v_total int; v_voted int;
begin
 select * into v_room from public.traitor_rooms r where r.id=p_room_id for update;
 select exists(select 1 from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user) into v_member;
 if not v_member then raise exception 'You are not a member of this room'; end if;
 select count(*) into v_total from public.traitor_players p where p.room_id=p_room_id;
 select count(*) into v_voted from public.traitor_votes v where v.room_id=p_room_id;
 if v_voted < v_total and v_room.phase_ends_at > now() then raise exception 'Wait for everyone to vote or for the timer to end'; end if;
 update public.traitor_rooms set status='revealed' where id=p_room_id;
 return jsonb_build_object('status','revealed','word',v_room.secret_word,'traitor_player_id',v_room.traitor_player_id,'traitor_name',(select p.display_name from public.traitor_players p where p.id=v_room.traitor_player_id));
end $$;

create or replace function public.traitor_chat_history(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_messages jsonb;
begin
 if v_user is null or not exists(select 1 from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user) then
   raise exception 'You are not a member of this room';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',m.id,'room_id',m.room_id,'player_id',m.player_id,
   'name',p.display_name,'text',m.message_text,'sent_at',m.created_at
 ) order by m.created_at), '[]'::jsonb)
 into v_messages
 from (select * from public.traitor_chat_messages where room_id=p_room_id order by created_at desc limit 150) m
 join public.traitor_players p on p.id=m.player_id and p.room_id=m.room_id;
 return v_messages;
end $$;

create or replace function public.traitor_send_chat_message(p_room_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_player public.traitor_players; v_room public.traitor_rooms; v_message public.traitor_chat_messages;
begin
 if v_user is null then raise exception 'Sign in required'; end if;
 select * into v_room from public.traitor_rooms r where r.id=p_room_id;
 if not found then raise exception 'This lobby no longer exists'; end if;
 if v_room.status not in ('playing','voting') then raise exception 'Chat is only available during an active game'; end if;
 select * into v_player from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user;
 if not found then raise exception 'You are not a member of this room'; end if;
 if p_text is null or char_length(trim(p_text)) not between 1 and 500 then raise exception 'Message must be 1–500 characters'; end if;
 insert into public.traitor_chat_messages(room_id,player_id,message_text)
 values(p_room_id,v_player.id,trim(p_text)) returning * into v_message;
 -- Keep only the newest 150 messages per lobby; older chat is automatically pruned.
 delete from public.traitor_chat_messages m
 where m.room_id=p_room_id and m.id not in (
   select recent.id from public.traitor_chat_messages recent
   where recent.room_id=p_room_id order by recent.created_at desc limit 150
 );
 return jsonb_build_object('id',v_message.id,'room_id',v_message.room_id,'player_id',v_player.id,
   'name',v_player.display_name,'text',v_message.message_text,'sent_at',v_message.created_at);
end $$;

create or replace function public.traitor_destroy_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room public.traitor_rooms;
begin
 select * into v_room from public.traitor_rooms r where r.id=p_room_id for update;
 if not found then return jsonb_build_object('ok',true,'already_destroyed',true); end if;
 if v_room.host_user_id <> v_user then raise exception 'Only the host can destroy this lobby'; end if;
 delete from public.traitor_rooms where id=p_room_id;
 -- Chat, votes and players are removed automatically through ON DELETE CASCADE.
 return jsonb_build_object('ok',true,'deleted_room_id',p_room_id);
end $$;

grant execute on function public.traitor_create_room(text,int,int,text) to authenticated;
grant execute on function public.traitor_join_room(text,text) to authenticated;
grant execute on function public.traitor_start_game(uuid) to authenticated;
grant execute on function public.traitor_my_role(uuid) to authenticated;
grant execute on function public.traitor_room_state(uuid) to authenticated;
grant execute on function public.traitor_cast_vote(uuid,uuid) to authenticated;
grant execute on function public.traitor_reveal(uuid) to authenticated;
grant execute on function public.traitor_chat_history(uuid) to authenticated;
grant execute on function public.traitor_send_chat_message(uuid,text) to authenticated;
grant execute on function public.traitor_destroy_room(uuid) to authenticated;
revoke execute on function public.traitor_chat_history(uuid) from public, anon;
revoke execute on function public.traitor_send_chat_message(uuid,text) from public, anon;
revoke execute on function public.traitor_destroy_room(uuid) from public, anon;

-- Needed for live roster/status/chat updates. Chat reads are restricted by room-membership RLS.
do $$ begin
 alter publication supabase_realtime add table public.traitor_rooms;
exception when duplicate_object then null; when undefined_object then raise notice 'Publication supabase_realtime not found; enable Realtime in the dashboard.'; end $$;
do $$ begin
 alter publication supabase_realtime add table public.traitor_players;
exception when duplicate_object then null; when undefined_object then raise notice 'Publication supabase_realtime not found; enable Realtime in the dashboard.'; end $$;
do $$ begin
 alter publication supabase_realtime add table public.traitor_chat_messages;
exception when duplicate_object then null; when undefined_object then raise notice 'Publication supabase_realtime not found; enable Realtime in the dashboard.'; end $$;
