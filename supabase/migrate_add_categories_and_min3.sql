-- MIGRATION SCRIPT: Run this in Supabase SQL Editor to enable Advanced Mode & Multi-Round Rules
-- This is backward compatible and adds game_mode, shield, kill, alive status, and new functions!

alter table public.traitor_rooms add column if not exists game_mode text not null default 'basic' check (game_mode in ('basic','advanced'));
alter table public.traitor_rooms add column if not exists round_number int not null default 1;
alter table public.traitor_rooms add column if not exists shielded_player_id uuid;
alter table public.traitor_rooms add column if not exists last_killed_player_id uuid;
alter table public.traitor_rooms add column if not exists last_voted_out_player_id uuid;
alter table public.traitor_rooms add column if not exists winner text check (winner in ('traitor','innocents'));

alter table public.traitor_rooms drop constraint if exists traitor_rooms_max_players_check;
alter table public.traitor_rooms add constraint traitor_rooms_max_players_check check (max_players between 3 and 20);

alter table public.traitor_rooms drop constraint if exists traitor_rooms_category_check;
alter table public.traitor_rooms add constraint traitor_rooms_category_check check (category in ('Places','Brands','Anime','Football','Cricket','Games','Countries','Animals','Movies','Comics'));

alter table public.traitor_rooms drop constraint if exists traitor_rooms_status_check;
alter table public.traitor_rooms add constraint traitor_rooms_status_check check (status in ('lobby','playing','voting','vote_result','shield','kill','revealed'));

alter table public.traitor_players add column if not exists is_alive boolean not null default true;

alter table public.traitor_votes add column if not exists round_number int not null default 1;
alter table public.traitor_votes add column if not exists vote_type text not null default 'eliminate';

-- Update primary key on traitor_votes safely
do $$ begin
  alter table public.traitor_votes drop constraint if exists traitor_votes_pkey;
  alter table public.traitor_votes add primary key(room_id, round_number, vote_type, voter_player_id);
exception when others then null; end $$;

-- Word helper function
create or replace function public.traitor_pick_word(p_category text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_words text[];
begin
  case p_category
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
  return v_words[1+floor(random()*array_length(v_words,1))::int];
end $$;

-- 1. Create Room (with game mode option)
create or replace function public.traitor_create_room(
  p_name text,
  p_max_players int,
  p_duration int,
  p_category text,
  p_game_mode text default 'basic'
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_room public.traitor_rooms;
  v_player public.traitor_players;
  v_code text;
  v_mode text := coalesce(p_game_mode, 'basic');
begin
 if v_user is null then raise exception 'Sign in required'; end if;
 if p_name is null or char_length(trim(p_name)) not between 1 and 24 then raise exception 'Name must be 1–24 characters'; end if;
 if p_max_players not between 3 and 20 then raise exception 'Player limit must be 3–20'; end if;
 if p_duration not in (8,10) then raise exception 'Duration must be 8 or 10 minutes'; end if;
 if p_category not in ('Places','Brands','Anime','Football','Cricket','Games','Countries','Animals','Movies','Comics') then raise exception 'Invalid category'; end if;
 if v_mode not in ('basic','advanced') then raise exception 'Invalid game mode'; end if;

 v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 while exists(select 1 from public.traitor_rooms r where r.code=v_code) loop
   v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 end loop;

 insert into public.traitor_rooms(code,host_user_id,max_players,duration_minutes,category,game_mode)
 values(v_code,v_user,p_max_players,p_duration,p_category,v_mode) returning * into v_room;

 insert into public.traitor_players(room_id,user_id,display_name,is_host,is_alive)
 values(v_room.id,v_user,trim(p_name),true,true) returning * into v_player;

 update public.traitor_rooms set host_player_id=v_player.id where id=v_room.id;

 return jsonb_build_object(
   'room_id',v_room.id,'code',v_room.code,'player_id',v_player.id,
   'players',jsonb_build_array(jsonb_build_object('id',v_player.id,'name',v_player.display_name,'host',true,'alive',true)),
   'max_players',v_room.max_players,'duration_minutes',v_room.duration_minutes,
   'category',v_room.category,'game_mode',v_room.game_mode,'status',v_room.status
 );
end $$;

-- 2. Join Room
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
   insert into public.traitor_players(room_id,user_id,display_name,is_alive) values(v_room.id,v_user,trim(p_name),true) returning * into v_player;
 end if;
 return jsonb_build_object('room_id',v_room.id,'code',v_room.code,'player_id',v_player.id,'max_players',v_room.max_players,'duration_minutes',v_room.duration_minutes,'category',v_room.category,'game_mode',v_room.game_mode,'status',v_room.status);
end $$;

-- 3. Start Game
create or replace function public.traitor_start_game(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_user uuid := auth.uid();
 v_room public.traitor_rooms;
 v_count int;
 v_traitor uuid;
 v_word text;
 v_cat text;
 v_all_cats text[] := array['Places','Brands','Anime','Football','Cricket','Games','Countries','Animals','Movies','Comics'];
begin
 select * into v_room from public.traitor_rooms r where r.id=p_room_id for update;
 if not found or v_room.host_user_id <> v_user then raise exception 'Only the host can start this game'; end if;
 if v_room.status <> 'lobby' then raise exception 'Game is not in the lobby'; end if;
 select count(*) into v_count from public.traitor_players p where p.room_id=p_room_id;
 if v_count < 3 then raise exception 'At least 3 players are required'; end if;

 if v_room.game_mode = 'advanced' then
   v_cat := v_all_cats[1+floor(random()*array_length(v_all_cats,1))::int];
 else
   v_cat := v_room.category;
 end if;

 v_word := public.traitor_pick_word(v_cat);
 select p.id into v_traitor from public.traitor_players p where p.room_id=p_room_id order by random() limit 1;

 update public.traitor_players set is_alive = true where room_id=p_room_id;

 update public.traitor_rooms
 set status='playing',
     round_number=1,
     category=v_cat,
     phase_ends_at=now() + make_interval(mins=>duration_minutes),
     traitor_player_id=v_traitor,
     secret_word=v_word,
     shielded_player_id=null,
     last_killed_player_id=null,
     last_voted_out_player_id=null,
     winner=null
 where id=p_room_id;

 return jsonb_build_object('status','playing','round_number',1,'category',v_cat,'phase_ends_at',now() + make_interval(mins=>v_room.duration_minutes));
end $$;

-- 4. My Role
create or replace function public.traitor_my_role(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room public.traitor_rooms; v_player public.traitor_players;
begin
 select * into v_player from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user;
 if not found then raise exception 'You are not a member of this room'; end if;
 select * into v_room from public.traitor_rooms r where r.id=p_room_id;
 if v_room.status='lobby' then raise exception 'Game has not started yet'; end if;

 return jsonb_build_object(
   'player_id',v_player.id,
   'is_alive',v_player.is_alive,
   'traitor_player_id',case when v_room.status='revealed' then v_room.traitor_player_id else null end,
   'is_traitor',v_player.id=v_room.traitor_player_id,
   'word',case when v_player.id=v_room.traitor_player_id then null else v_room.secret_word end,
   'category',v_room.category,
   'status',v_room.status,
   'round_number',v_room.round_number,
   'phase_ends_at',v_room.phase_ends_at
 );
end $$;

-- 5. Room State
create or replace function public.traitor_room_state(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room public.traitor_rooms;
begin
 select * into v_room from public.traitor_rooms r where r.id=p_room_id;
 if not found or not exists(select 1 from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user) then
   raise exception 'You are not a member of this room';
 end if;
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
   'players',(
     select coalesce(jsonb_agg(jsonb_build_object(
       'id',p.id,'name',p.display_name,'host',p.is_host,'alive',p.is_alive
     ) order by p.joined_at),'[]'::jsonb)
     from public.traitor_players p where p.room_id=p_room_id
   )
 );
end $$;

-- 6. Cast Eliminate Vote
create or replace function public.traitor_cast_vote(p_room_id uuid, p_target_player_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_user uuid := auth.uid();
 v_voter public.traitor_players;
 v_room public.traitor_rooms;
begin
 select * into v_voter from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user;
 if not found or not v_voter.is_alive then raise exception 'Only alive players can vote'; end if;
 select * into v_room from public.traitor_rooms r where r.id=p_room_id;
 if v_room.status not in ('playing','voting') then raise exception 'Voting is not open'; end if;
 if not exists(select 1 from public.traitor_players p where p.id=p_target_player_id and p.room_id=p_room_id and p.is_alive) then
   raise exception 'Invalid vote target (must be an alive player)';
 end if;

 insert into public.traitor_votes(room_id,round_number,vote_type,voter_player_id,target_player_id)
 values(p_room_id,v_room.round_number,'eliminate',v_voter.id,p_target_player_id)
 on conflict(room_id,round_number,vote_type,voter_player_id)
 do update set target_player_id=excluded.target_player_id,created_at=now();

 update public.traitor_rooms set status='voting' where id=p_room_id and status='playing';
 return jsonb_build_object('ok',true);
end $$;

-- 7. Resolve Vote
create or replace function public.traitor_resolve_vote(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_user uuid := auth.uid();
 v_room public.traitor_rooms;
 v_alive_count int;
 v_target uuid;
 v_is_traitor boolean;
 v_alive_innocents int;
begin
 select * into v_room from public.traitor_rooms r where r.id=p_room_id for update;
 if not found then raise exception 'Room not found'; end if;

 select target_player_id into v_target
 from public.traitor_votes
 where room_id=p_room_id and round_number=v_room.round_number and vote_type='eliminate'
 group by target_player_id
 order by count(*) desc, random()
 limit 1;

 if v_target is null then
   select id into v_target from public.traitor_players where room_id=p_room_id and is_alive=true order by random() limit 1;
 end if;

 update public.traitor_players set is_alive=false where id=v_target;
 v_is_traitor := (v_target = v_room.traitor_player_id);

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

 select count(*) into v_alive_innocents from public.traitor_players
 where room_id=p_room_id and is_alive=true and id <> v_room.traitor_player_id;

 if v_alive_innocents <= 1 then
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

 select count(*) into v_alive_count from public.traitor_players where room_id=p_room_id and is_alive=true;

 update public.traitor_rooms
 set status='vote_result',
     last_voted_out_player_id=v_target
 where id=p_room_id;

 return jsonb_build_object(
   'status','vote_result',
   'voted_out_id',v_target,
   'is_traitor',false,
   'alive_count',v_alive_count
 );
end $$;

-- 8. Advance Phase to Shield or Kill
create or replace function public.traitor_advance_phase(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_room public.traitor_rooms;
 v_alive_count int;
begin
 select * into v_room from public.traitor_rooms where id=p_room_id;
 if not found then raise exception 'Room not found'; end if;
 select count(*) into v_alive_count from public.traitor_players where room_id=p_room_id and is_alive=true;

 if v_alive_count >= 5 then
   update public.traitor_rooms set status='shield', phase_ends_at=now() + interval '60 seconds' where id=p_room_id;
   return jsonb_build_object('status','shield');
 else
   update public.traitor_rooms set status='kill', phase_ends_at=now() + interval '60 seconds' where id=p_room_id;
   return jsonb_build_object('status','kill');
 end if;
end $$;

-- 9. Cast Shield Vote
create or replace function public.traitor_cast_shield(p_room_id uuid, p_target_player_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_user uuid := auth.uid();
 v_voter public.traitor_players;
 v_room public.traitor_rooms;
begin
 select * into v_voter from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user;
 if not found or not v_voter.is_alive then raise exception 'Only alive players can vote for shield'; end if;
 select * into v_room from public.traitor_rooms r where r.id=p_room_id;
 if v_room.status <> 'shield' then raise exception 'Shield voting is not open'; end if;

 if v_voter.id = v_room.traitor_player_id then
   raise exception 'The traitor cannot grant shields';
 end if;

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

 return jsonb_build_object('ok',true);
end $$;

-- 10. Resolve Shield
create or replace function public.traitor_resolve_shield(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_room public.traitor_rooms;
 v_shielded uuid;
begin
 select * into v_room from public.traitor_rooms r where r.id=p_room_id for update;
 if v_room.status <> 'shield' then raise exception 'Not in shield phase'; end if;

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

-- 11. Traitor Kill Player
create or replace function public.traitor_kill_player(p_room_id uuid, p_target_player_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_user uuid := auth.uid();
 v_room public.traitor_rooms;
 v_traitor public.traitor_players;
 v_killed boolean := false;
 v_alive_innocents int;
 v_all_cats text[] := array['Places','Brands','Anime','Football','Cricket','Games','Countries','Animals','Movies','Comics'];
 v_new_cat text;
 v_new_word text;
begin
 select * into v_room from public.traitor_rooms r where r.id=p_room_id for update;
 if v_room.status <> 'kill' then raise exception 'Kill phase is not active'; end if;

 select * into v_traitor from public.traitor_players p where p.room_id=p_room_id and p.id=v_room.traitor_player_id and p.user_id=v_user;
 if not found then raise exception 'Only the traitor can perform the kill'; end if;

 if not exists(select 1 from public.traitor_players p where p.id=p_target_player_id and p.room_id=p_room_id and p.is_alive and p.id <> v_room.traitor_player_id) then
   raise exception 'Invalid kill target';
 end if;

 if v_room.shielded_player_id = p_target_player_id then
   v_killed := false;
   update public.traitor_rooms set last_killed_player_id=null where id=p_room_id;
 else
   v_killed := true;
   update public.traitor_players set is_alive=false where id=p_target_player_id;
   update public.traitor_rooms set last_killed_player_id=p_target_player_id where id=p_room_id;
 end if;

 select count(*) into v_alive_innocents from public.traitor_players
 where room_id=p_room_id and is_alive=true and id <> v_room.traitor_player_id;

 if v_alive_innocents <= 1 then
   update public.traitor_rooms
   set status='revealed',
       winner='traitor'
   where id=p_room_id;

   return jsonb_build_object(
     'status','revealed',
     'winner','traitor',
     'killed',v_killed,
     'killed_id',case when v_killed then p_target_player_id else null end,
     'word',v_room.secret_word,
     'traitor_player_id',v_room.traitor_player_id
   );
 else
   v_new_cat := v_all_cats[1+floor(random()*array_length(v_all_cats,1))::int];
   v_new_word := public.traitor_pick_word(v_new_cat);

   update public.traitor_rooms
   set status='playing',
       round_number=v_room.round_number + 1,
       category=v_new_cat,
       secret_word=v_new_word,
       shielded_player_id=null,
       phase_ends_at=now() + make_interval(mins=>v_room.duration_minutes)
   where id=p_room_id;

   return jsonb_build_object(
     'status','playing',
     'round_number',v_room.round_number + 1,
     'killed',v_killed,
     'killed_id',case when v_killed then p_target_player_id else null end
   );
 end if;
end $$;

-- 12. Reveal
create or replace function public.traitor_reveal(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room public.traitor_rooms; v_member boolean;
begin
 select * into v_room from public.traitor_rooms r where r.id=p_room_id;
 select exists(select 1 from public.traitor_players p where p.room_id=p_room_id and p.user_id=v_user) into v_member;
 if not v_member then raise exception 'You are not a member of this room'; end if;

 return jsonb_build_object(
   'status',v_room.status,
   'word',v_room.secret_word,
   'traitor_player_id',v_room.traitor_player_id,
   'traitor_name',(select p.display_name from public.traitor_players p where p.id=v_room.traitor_player_id),
   'winner',v_room.winner,
   'round_number',v_room.round_number,
   'last_voted_out_player_id',v_room.last_voted_out_player_id,
   'last_killed_player_id',v_room.last_killed_player_id
 );
end $$;

-- Grant permissions for all new RPCs
grant execute on function public.traitor_create_room(text,int,int,text,text) to authenticated;
grant execute on function public.traitor_join_room(text,text) to authenticated;
grant execute on function public.traitor_start_game(uuid) to authenticated;
grant execute on function public.traitor_my_role(uuid) to authenticated;
grant execute on function public.traitor_room_state(uuid) to authenticated;
grant execute on function public.traitor_cast_vote(uuid,uuid) to authenticated;
grant execute on function public.traitor_resolve_vote(uuid) to authenticated;
grant execute on function public.traitor_advance_phase(uuid) to authenticated;
grant execute on function public.traitor_cast_shield(uuid,uuid) to authenticated;
grant execute on function public.traitor_resolve_shield(uuid) to authenticated;
grant execute on function public.traitor_kill_player(uuid,uuid) to authenticated;
grant execute on function public.traitor_reveal(uuid) to authenticated;
