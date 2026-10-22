-- MIGRATION: Add Animals, Movies, Comics categories + reduce min players to 3
-- Run this in Supabase Dashboard > SQL Editor > New Query > paste > Run

-- 1. Update max_players constraint (4-20 → 3-20)
ALTER TABLE public.traitor_rooms DROP CONSTRAINT IF EXISTS traitor_rooms_max_players_check;
ALTER TABLE public.traitor_rooms ADD CONSTRAINT traitor_rooms_max_players_check CHECK (max_players BETWEEN 3 AND 20);

-- 2. Update category constraint (add Animals, Movies, Comics)
ALTER TABLE public.traitor_rooms DROP CONSTRAINT IF EXISTS traitor_rooms_category_check;
ALTER TABLE public.traitor_rooms ADD CONSTRAINT traitor_rooms_category_check CHECK (category IN ('Places','Brands','Anime','Football','Cricket','Games','Countries','Animals','Movies','Comics'));

-- 3. Recreate traitor_create_room with new validations
CREATE OR REPLACE FUNCTION public.traitor_create_room(p_name text, p_max_players int, p_duration int, p_category text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_room public.traitor_rooms; v_player public.traitor_players; v_code text;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
 IF p_name IS NULL OR char_length(trim(p_name)) NOT BETWEEN 1 AND 24 THEN RAISE EXCEPTION 'Name must be 1–24 characters'; END IF;
 IF p_max_players NOT BETWEEN 3 AND 20 THEN RAISE EXCEPTION 'Player limit must be 3–20'; END IF;
 IF p_duration NOT IN (8,10) THEN RAISE EXCEPTION 'Duration must be 8 or 10 minutes'; END IF;
 IF p_category NOT IN ('Places','Brands','Anime','Football','Cricket','Games','Countries','Animals','Movies','Comics') THEN RAISE EXCEPTION 'Invalid category'; END IF;
 v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 WHILE EXISTS(SELECT 1 FROM public.traitor_rooms r WHERE r.code=v_code) LOOP v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)); END LOOP;
 INSERT INTO public.traitor_rooms(code,host_user_id,max_players,duration_minutes,category) VALUES(v_code,v_user,p_max_players,p_duration,p_category) RETURNING * INTO v_room;
 INSERT INTO public.traitor_players(room_id,user_id,display_name,is_host) VALUES(v_room.id,v_user,trim(p_name),true) RETURNING * INTO v_player;
 UPDATE public.traitor_rooms SET host_player_id=v_player.id WHERE id=v_room.id;
 RETURN jsonb_build_object('room_id',v_room.id,'code',v_room.code,'player_id',v_player.id,'players',jsonb_build_array(jsonb_build_object('id',v_player.id,'name',v_player.display_name,'host',true)),'max_players',v_room.max_players,'duration_minutes',v_room.duration_minutes,'category',v_room.category,'status',v_room.status);
END $$;

-- 4. Recreate traitor_start_game with new categories + min 3 players
CREATE OR REPLACE FUNCTION public.traitor_start_game(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_room public.traitor_rooms; v_count int; v_traitor uuid; v_word text; v_words text[];
BEGIN
 SELECT * INTO v_room FROM public.traitor_rooms r WHERE r.id=p_room_id FOR UPDATE;
 IF NOT FOUND OR v_room.host_user_id <> v_user THEN RAISE EXCEPTION 'Only the host can start this game'; END IF;
 IF v_room.status <> 'lobby' THEN RAISE EXCEPTION 'Game is not in the lobby'; END IF;
 SELECT count(*) INTO v_count FROM public.traitor_players p WHERE p.room_id=p_room_id;
 IF v_count < 3 THEN RAISE EXCEPTION 'At least 3 players are required'; END IF;
 CASE v_room.category
 WHEN 'Places' THEN v_words := array['Tokyo','Eiffel Tower','Grand Canyon','Mumbai','Great Barrier Reef','Taj Mahal','New York','Mount Everest','Santorini','Colosseum'];
 WHEN 'Brands' THEN v_words := array['Nike','LEGO','Apple','Coca-Cola','Netflix','Adidas','IKEA','Samsung','Spotify','Nintendo'];
 WHEN 'Anime' THEN v_words := array['Naruto','One Piece','Demon Slayer','Jujutsu Kaisen','Death Note','Dragon Ball','Attack on Titan','Pokémon'];
 WHEN 'Football' THEN v_words := array['Lionel Messi','Cristiano Ronaldo','Neymar Jr.','Kylian Mbappé','Erling Haaland','Sunil Chhetri'];
 WHEN 'Cricket' THEN v_words := array['Virat Kohli','MS Dhoni','Rohit Sharma','Jasprit Bumrah','AB de Villiers','Sachin Tendulkar'];
 WHEN 'Games' THEN v_words := array['Minecraft','Fortnite','GTA V','Among Us','Valorant','FIFA','Clash of Clans'];
 WHEN 'Countries' THEN v_words := array['Japan','Brazil','India','Iceland','Canada','Egypt','Australia','Argentina'];
 WHEN 'Animals' THEN v_words := array['Lion','Elephant','Dolphin','Eagle','Panda','Wolf','Shark','Penguin','Tiger','Cheetah'];
 WHEN 'Movies' THEN v_words := array['Inception','Titanic','Avatar','Interstellar','The Dark Knight','Avengers','Jurassic Park','Forrest Gump','The Matrix','Gladiator'];
 WHEN 'Comics' THEN v_words := array['Spider-Man','Batman','Iron Man','Superman','Wolverine','Wonder Woman','Thor','The Joker','Deadpool','Black Panther'];
 ELSE v_words := array['Japan','Brazil','India','Iceland','Canada','Egypt','Australia','Argentina'];
 END CASE;
 SELECT p.id INTO v_traitor FROM public.traitor_players p WHERE p.room_id=p_room_id ORDER BY random() LIMIT 1;
 v_word := v_words[1+floor(random()*array_length(v_words,1))::int];
 UPDATE public.traitor_rooms SET status='playing',phase_ends_at=now() + make_interval(mins=>duration_minutes),traitor_player_id=v_traitor,secret_word=v_word WHERE id=p_room_id;
 RETURN jsonb_build_object('status','playing','phase_ends_at',now() + make_interval(mins=>v_room.duration_minutes));
END $$;

