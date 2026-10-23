"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ensureAnonymousSession, getSupabase } from "../lib/supabase";
import { 
  ArrowRight, ArrowLeft, Copy, Crown, Eye, EyeOff, Link2, LockKeyhole, Plus, Shield, Sparkles, Timer, Users, Vote, X, Check, Volume2, Shuffle, Ghost, CircleHelp, Zap, MessageCircle, Send, Wifi, UsersRound, Skull, ShieldCheck, Swords, Trophy, AlertTriangle
} from "lucide-react";

type Screen = "home" | "setup" | "join" | "lobby" | "role" | "game" | "vote" | "vote_result" | "shield" | "kill" | "reveal";
type Player = { id:string; name:string; host?:boolean; traitor?:boolean; alive?:boolean };
type ChatMessage = { id:string; playerId:string; name:string; text:string; sentAt:string };
const normalizeChatMessage = (value:any):ChatMessage => ({ 
  id:String(value.id), 
  playerId:String(value.player_id ?? value.playerId), 
  name:String(value.name ?? "Player"), 
  text:String(value.text ?? value.message_text ?? ""), 
  sentAt:String(value.sent_at ?? value.sentAt ?? value.created_at ?? new Date().toISOString()) 
});

const WORDS = {
  Places:["Tokyo","Eiffel Tower","Grand Canyon","Mumbai","Great Barrier Reef","Taj Mahal","New York","Mount Everest","Santorini","Colosseum"],
  Brands:["Nike","LEGO","Apple","Coca-Cola","Netflix","Adidas","IKEA","Samsung","Spotify","Nintendo"],
  Anime:["Naruto","One Piece","Demon Slayer","Jujutsu Kaisen","Death Note","Dragon Ball","Attack on Titan","Pokémon"],
  Football:["Lionel Messi","Cristiano Ronaldo","Neymar Jr.","Kylian Mbappé","Erling Haaland","Sunil Chhetri"],
  Cricket:["Virat Kohli","MS Dhoni","Rohit Sharma","Jasprit Bumrah","AB de Villiers","Sachin Tendulkar"],
  Games:["Minecraft","Fortnite","GTA V","Among Us","Valorant","FIFA","Clash of Clans"],
  Countries:["Japan","Brazil","India","Iceland","Canada","Egypt","Australia","Argentina"],
  Animals:["Lion","Elephant","Dolphin","Eagle","Panda","Wolf","Shark","Penguin","Tiger","Cheetah"],
  Movies:["Inception","Titanic","Avatar","Interstellar","The Dark Knight","Avengers","Jurassic Park","Forrest Gump","The Matrix","Gladiator"],
  Comics:["Spider-Man","Batman","Iron Man","Superman","Wolverine","Wonder Woman","Thor","The Joker","Deadpool","Black Panther"]
};
const categories = Object.keys(WORDS);

const LOBBY_COOKIE = "traitors_lobby_session";
type SavedLobbySession = { roomId: string; playerId: string };
const saveLobbySession = (roomId: string, playerId: string) => {
  if (typeof document === "undefined" || !roomId || !playerId) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const value = encodeURIComponent(JSON.stringify({ roomId, playerId }));
  document.cookie = `${LOBBY_COOKIE}=${value}; Path=/; Max-Age=34560000; SameSite=Lax${secure}`;
};
const readLobbySession = (): SavedLobbySession | null => {
  if (typeof document === "undefined") return null;
  const entry = document.cookie.split("; ").find((item) => item.startsWith(`${LOBBY_COOKIE}=`));
  if (!entry) return null;
  const raw = entry.slice(LOBBY_COOKIE.length + 1);
  try {
    const value = JSON.parse(decodeURIComponent(raw));
    if (typeof value?.roomId === "string" && typeof value?.playerId === "string" && value.roomId && value.playerId) {
      return { roomId: value.roomId, playerId: value.playerId };
    }
  } catch {}
  clearLobbySession();
  return null;
};
const clearLobbySession = () => {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOBBY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
};

export default function Home() {
  const [screen,setScreen] = useState<Screen>("home");
  const [name,setName] = useState("");
  const [hostName,setHostName] = useState("");
  const [maxPlayers,setMaxPlayers] = useState(8);
  const [duration,setDuration] = useState(8);
  const [category,setCategory] = useState("Places");
  const [gameMode,setGameMode] = useState<"basic"|"advanced">("basic");
  const [roomCode,setRoomCode] = useState("");
  const [roomId,setRoomId] = useState("");
  const [playerId,setPlayerId] = useState("");
  const [isHost,setIsHost] = useState(false);
  const [players,setPlayers] = useState<Player[]>([]);
  const [word,setWord] = useState("");
  const [isTraitor,setIsTraitor] = useState(false);
  const [isAlive,setIsAlive] = useState(true);
  const [showWord,setShowWord] = useState(false);
  const [copied,setCopied] = useState(false);
  const [seconds,setSeconds] = useState(0);
  const [selectedVote,setSelectedVote] = useState("");
  const [selectedShield,setSelectedShield] = useState("");
  const [selectedKill,setSelectedKill] = useState("");
  const [toast,setToast] = useState("");
  const [round,setRound] = useState(1);
  const [votesCast,setVotesCast] = useState(0);
  const [shieldVotesCast,setShieldVotesCast] = useState(0);
  const [hasVoted,setHasVoted] = useState(false);
  const [hasShieldVoted,setHasShieldVoted] = useState(false);
  const prevRoundRef = useRef(1);
  const [joinCode,setJoinCode] = useState("");
  const [joinedName,setJoinedName] = useState("");
  const [traitorId,setTraitorId] = useState("");
  const [winner,setWinner] = useState<"traitor"|"innocents"|null>(null);
  const [lastVotedOutId,setLastVotedOutId] = useState("");
  const [lastKilledId,setLastKilledId] = useState("");
  const [shieldedId,setShieldedId] = useState("");
  const [showQr,setShowQr] = useState(false);
  const [chatMessages,setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft,setChatDraft] = useState("");
  const [chatTab,setChatTab] = useState<"discussion"|"chat">("chat");
  const [chatConnected,setChatConnected] = useState(false);
  const [chatUnread,setChatUnread] = useState(0);
  const chatChannelRef = useRef<any>(null);

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}/?join=${roomCode}` : "";
  const alivePlayers = useMemo(()=>players.filter(p=>p.alive!==false),[players]);
  const me = useMemo(()=>players.find(p=>p.id===playerId),[players,playerId]);

  useEffect(()=>{ if(!toast) return; const t=setTimeout(()=>setToast(""),3000); return ()=>clearTimeout(t); },[toast]);
  useEffect(()=>{ 
    if(!["game","shield","kill"].includes(screen) || seconds<=0) return; 
    const t=setTimeout(()=>setSeconds(s=>s-1),1000); 
    return ()=>clearTimeout(t); 
  },[screen,seconds]);

  // When game timer hits zero -> move to vote
  useEffect(()=>{ 
    if(screen==="game" && seconds===0) setScreen("vote"); 
  },[screen,seconds]);

  const createRoom = async () => {
    try {
      if(!name.trim()){setToast("Enter your name first");return;}
      const supabase=getSupabase(); await ensureAnonymousSession();
      const {data,error}=await supabase.rpc("traitor_create_room",{
        p_name:name.trim(),
        p_max_players:maxPlayers,
        p_duration:duration,
        p_category:category,
        p_game_mode:gameMode
      });
      if(error) throw error;
      const r=data as any;
      saveLobbySession(r.room_id, r.player_id);
      setRoomId(r.room_id); setRoomCode(r.code); setPlayerId(r.player_id); setIsHost(true); setHostName(name.trim());
      setPlayers((r.players||[]).map((p:any)=>({id:p.id,name:p.name,host:p.host,alive:true})));
      setGameMode(r.game_mode||"basic");
      setScreen("lobby");
    } catch(e:any){setToast(e?.message||"Could not create room. Run migration in Supabase.");}
  };

  const addDemoPlayer = () => setToast("Demo players disabled. Share the invite code with real friends!");

  const startGame = async () => {
    if(players.length < 3){setToast("You need at least 3 players to start");return;}
    try {
      const supabase=getSupabase(); 
      const {error}=await supabase.rpc("traitor_start_game",{p_room_id:roomId}); 
      if(error) throw error; 
      await refreshRoom(roomId);
    } catch(e:any){setToast(e?.message||"Could not start the game.");}
  };

  const joinGame = async () => {
    if(!joinedName.trim()){setToast("Enter your name to join");return;} 
    if(joinCode.trim().length<4){setToast("Enter a valid room code");return;}
    try {
      const supabase=getSupabase(); await ensureAnonymousSession(); 
      const {data,error}=await supabase.rpc("traitor_join_room",{p_code:joinCode.trim().toUpperCase(),p_name:joinedName.trim()}); 
      if(error) throw error; 
      const r=data as any; 
      saveLobbySession(r.room_id, r.player_id);
      setRoomId(r.room_id);setRoomCode(r.code);setPlayerId(r.player_id);setIsHost(false);
      setName(joinedName.trim());setHostName("Game host");setScreen("lobby"); 
      await refreshRoom(r.room_id);
    } catch(e:any){setToast(e?.message||"Could not join room.");}
  };

  const refreshRoom = async (id:string) => {
    try {
      const {data,error}=await getSupabase().rpc("traitor_room_state",{p_room_id:id});
      if(error) throw error;
      const r=data as any;
      const roster=(r.players||[]).map((p:any)=>({id:p.id,name:p.name,host:p.host,alive:p.alive!==false}));
      setPlayers(roster);
      setRoomCode(r.code);
      setMaxPlayers(r.max_players);
      setDuration(r.duration_minutes);
      setCategory(r.category);
      setGameMode(r.game_mode||"basic");
      const newRound = r.round_number || 1;
      const isNewRound = newRound > prevRoundRef.current;
      if (isNewRound) {
        prevRoundRef.current = newRound;
        setRound(newRound);
        setSelectedVote("");
        setSelectedShield("");
        setSelectedKill("");
        setHasVoted(false);
        setHasShieldVoted(false);
        if (r.status === "playing") {
          setScreen("role");
        }
      } else {
        setRound(newRound);
      }
      setVotesCast(r.votes_cast || 0);
      setShieldVotesCast(r.shield_votes_cast || 0);
      setHasVoted(!!r.has_voted);
      setHasShieldVoted(!!r.has_shield_voted);
      setShieldedId(r.shielded_player_id||"");
      setLastKilledId(r.last_killed_player_id||"");
      setLastVotedOutId(r.last_voted_out_player_id||"");
      if(r.winner) setWinner(r.winner);

      const myPlayer=roster.find((p:any)=>p.id===playerId);
      if(myPlayer) setIsAlive(myPlayer.alive!==false);

      if(r.status==="lobby") { setScreen("lobby"); return; }
      if(r.status==="revealed") {
        const {data:result}=await getSupabase().rpc("traitor_reveal",{p_room_id:id});
        if(result){
          setWord((result as any).word||"");
          setTraitorId((result as any).traitor_player_id||"");
          setWinner((result as any).winner||null);
          setScreen("reveal");
        }
        return;
      }

      // Check role
      const {data:role}=await getSupabase().rpc("traitor_my_role",{p_room_id:id});
      if(role){
        setIsTraitor(!!(role as any).is_traitor);
        setWord((role as any).word||"");
        if((role as any).traitor_player_id) setTraitorId((role as any).traitor_player_id);
      }

      // Sync screen based on backend status:
      // IMPORTANT: DO NOT bounce back to 'role' if user has already pressed 'I am ready' and is on 'game'!
      if(r.status==="playing") {
        const endTime=r.phase_ends_at;
        const rem=endTime?Math.max(0,Math.floor((new Date(endTime).getTime()-Date.now())/1000)):duration*60;
        setSeconds(rem);
        setScreen(curr => (curr === "lobby" ? "role" : curr));
      } else if(r.status==="voting") {
        setScreen("vote");
      } else if(r.status==="vote_result") {
        setScreen("vote_result");
      } else if(r.status==="shield") {
        setScreen("shield");
      } else if(r.status==="kill") {
        setScreen("kill");
      }
    } catch(e:any){
      console.warn("Refresh room error", e);
    }
  };

  // Realtime subscription for room changes
  useEffect(()=>{
    if(!roomId) return;
    const supabase=getSupabase();
    const channel=supabase.channel(`room-${roomId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"traitor_rooms",filter:`id=eq.${roomId}`},()=>{
        void refreshRoom(roomId);
      })
      .on("postgres_changes",{event:"*",schema:"public",table:"traitor_players",filter:`room_id=eq.${roomId}`},()=>{
        void refreshRoom(roomId);
      })
      .subscribe();

    const poll=window.setInterval(()=>{void refreshRoom(roomId);},3000);
    return ()=>{window.clearInterval(poll);void supabase.removeChannel(channel);};
  },[roomId,playerId]);

  // Realtime chat subscription
  useEffect(()=>{
    if(!roomId || !playerId) return;
    let active=true;
    const supabase=getSupabase();
    const channel=supabase.channel(`traitor-chat-${roomId}`)
      .on("postgres_changes", { event:"INSERT", schema:"public", table:"traitor_chat_messages", filter:`room_id=eq.${roomId}` }, async(payload)=>{
        if(!active) return;
        const {data,error}=await supabase.rpc("traitor_chat_history", {p_room_id:roomId});
        if(error || !active || !Array.isArray(data)) return;
        const messages=(data as any[]).map(normalizeChatMessage);
        setChatMessages(messages.slice(-150));
        if(payload.new && (payload.new as any).player_id!==playerId && (screen!=="game" || chatTab!=="chat")) {
          setChatUnread(count=>count+1);
        }
      })
      .subscribe((status)=>{
        if(active) setChatConnected(status==="SUBSCRIBED");
      });
    chatChannelRef.current=channel;

    void (async()=>{
      const {data,error}=await supabase.rpc("traitor_chat_history", {p_room_id:roomId});
      if(!error && active && Array.isArray(data)) setChatMessages((data as any[]).map(normalizeChatMessage).slice(-150));
    })();

    return ()=>{active=false;setChatConnected(false);chatChannelRef.current=null;void supabase.removeChannel(channel);};
  },[roomId,playerId,screen,chatTab]);

  const sendChatMessage = async () => {
    const text=chatDraft.trim();
    if(!text || !roomId || !playerId) return;
    if(text.length>500){setToast("Messages must be 500 characters or fewer");return;}
    setChatDraft("");
    try {
      const {data,error}=await getSupabase().rpc("traitor_send_chat_message", {p_room_id:roomId,p_text:text});
      if(error) throw error;
      const message=normalizeChatMessage(data);
      setChatMessages(current=>current.some(item=>item.id===message.id)?current:[...current,message].slice(-150));
    } catch(e:any){setChatDraft(text);setToast(e?.message||"Could not send message");}
  };

  const startRound = () => {
    setSeconds(duration*60);
    setChatTab("chat");
    setChatUnread(0);
    setScreen("game");
  };

  const submitVote = async () => {
    if(!selectedVote){setToast("Choose who you suspect");return;}
    try {
      const {data,error}=await getSupabase().rpc("traitor_cast_vote",{p_room_id:roomId,p_target_player_id:selectedVote});
      if(error) throw error;
      setHasVoted(true);
      const res=data as any;
      if(res?.resolved) {
        setToast("All votes locked in! Resolving verdict...");
      } else {
        setToast(`Vote locked in! (${res?.votes_cast || 1}/${res?.alive_count || alivePlayers.length} ready)`);
      }
      await refreshRoom(roomId);
    } catch(e:any){setToast(e?.message||"Could not submit vote.");}
  };

  const forceResolveVote = async () => {
    try {
      const {error}=await getSupabase().rpc("traitor_resolve_vote",{p_room_id:roomId});
      if(error) throw error;
      setToast("Tallying votes now...");
      await refreshRoom(roomId);
    } catch(e:any){setToast(e?.message||"Could not resolve votes.");}
  };

  const advanceFromVoteResult = async () => {
    try {
      const {data,error}=await getSupabase().rpc("traitor_advance_phase",{p_room_id:roomId});
      if(error) throw error;
      await refreshRoom(roomId);
    } catch(e:any){setToast(e?.message||"Could not advance phase.");}
  };

  const submitShield = async () => {
    if(!selectedShield){setToast("Pick an innocent player to rescue");return;}
    try {
      const {data,error}=await getSupabase().rpc("traitor_cast_shield",{p_room_id:roomId,p_target_player_id:selectedShield});
      if(error) throw error;
      setHasShieldVoted(true);
      const res=data as any;
      if(res?.resolved) {
        setToast("All shield votes in! Shield granted.");
      } else {
        setToast(`Shield vote registered! (${res?.shield_votes || 1}/${res?.needed || Math.max(1, alivePlayers.length - 1)} voted)`);
      }
      await refreshRoom(roomId);
    } catch(e:any){setToast(e?.message||"Could not submit shield vote.");}
  };

  const forceResolveShield = async () => {
    try {
      const {error}=await getSupabase().rpc("traitor_resolve_shield",{p_room_id:roomId});
      if(error) throw error;
      setToast("Resolving shield now...");
      await refreshRoom(roomId);
    } catch(e:any){setToast(e?.message||"Could not resolve shield.");}
  };

  const submitKill = async () => {
    if(!selectedKill){setToast("Pick a target to assassinate");return;}
    try {
      const {data,error}=await getSupabase().rpc("traitor_kill_player",{p_room_id:roomId,p_target_player_id:selectedKill});
      if(error) throw error;
      const res=data as any;
      if(res.killed) {
        setToast("Target eliminated!");
      } else {
        setToast("Attack was BLOCKED by the rescue shield!");
      }
      await refreshRoom(roomId);
    } catch(e:any){setToast(e?.message||"Could not execute kill.");}
  };

  const leaveLobby = async () => {
    if(!roomId){reset();return;}
    if(isHost){
      const confirmed=window.confirm("Destroy this lobby for everyone? All game progress will be deleted.");
      if(!confirmed) return;
      try { 
        const {error}=await getSupabase().rpc("traitor_destroy_room", {p_room_id:roomId}); 
        if(error) throw error; 
        setToast("Lobby deleted"); 
      } catch(e:any){setToast(e?.message||"Could not destroy lobby");return;}
    }
    reset();
  };

  const reset = () => {
    clearLobbySession();
    setScreen("home");
    setPlayers([]);
    setRoomCode("");
    setRoomId("");
    setPlayerId("");
    setIsHost(false);
    setWord("");
    setIsTraitor(false);
    setIsAlive(true);
    setTraitorId("");
    setWinner(null);
    setSeconds(0);
    setSelectedVote("");
    setSelectedShield("");
    setSelectedKill("");
    setRound(1);
    setVotesCast(0);
    setShieldVotesCast(0);
    setHasVoted(false);
    setHasShieldVoted(false);
    prevRoundRef.current = 1;
    setChatMessages([]);
    setChatDraft("");
    setChatUnread(0);
  };

  // Restore saved session on load
  useEffect(()=>{
    let active=true;
    const restoreLobby=async()=>{
      const requestedCode=typeof window!=="undefined" ? new URLSearchParams(window.location.search).get("join") : null;
      const saved=readLobbySession();
      if(!saved){
        if(requestedCode){setJoinCode(requestedCode.toUpperCase());setScreen("join");}
        return;
      }
      try {
        const supabase=getSupabase();
        await ensureAnonymousSession();
        const {data,error}=await supabase.rpc("traitor_room_state",{p_room_id:saved.roomId});
        if(error) { clearLobbySession(); return; }
        if(!active) return;
        const room=data as any;
        if(requestedCode && String(room.code).toUpperCase()!==requestedCode.toUpperCase()){
          setJoinCode(requestedCode.toUpperCase());setScreen("join");return;
        }
        setRoomId(saved.roomId);
        setPlayerId(saved.playerId);
        await refreshRoom(saved.roomId);
      } catch(e){}
    };
    void restoreLobby();
    return ()=>{active=false;};
  },[]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setToast("Invite link copied to clipboard");
      setTimeout(()=>setCopied(false),1800);
    } catch { setToast(shareUrl); }
  };

  const fmt = (s:number) => `${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;

  const lastVotedPlayerName = useMemo(()=>players.find(p=>p.id===lastVotedOutId)?.name || null,[players,lastVotedOutId]);
  const lastKilledPlayerName = useMemo(()=>players.find(p=>p.id===lastKilledId)?.name || null,[players,lastKilledId]);
  const traitorName = useMemo(()=>players.find(p=>p.id===traitorId)?.name || "The Traitor",[players,traitorId]);

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand" onClick={()=>void (roomId?leaveLobby():reset())}>
          <span className="brand-icon"><Ghost size={21}/></span>
          <span>TRAITORS<span className="brand-dot">.</span><small>TRUST NO ONE</small></span>
        </button>
        <div className="top-right">
          {gameMode==="advanced" && <span className="round-pill"><Swords size={12}/> ADVANCED · R{round}</span>}
          <span className="live-dot"/> {gameMode==="advanced"?"ADVANCED MODE":"CLASSIC PARTY"} <span className="top-sep">·</span>
          <span className="online">NO LOGIN</span>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="progress">
        <span style={{
          width:({home:10,setup:25,join:20,lobby:40,role:55,game:70,vote:80,vote_result:85,shield:90,kill:95,reveal:100}[screen])+"%"
        }}/>
      </div>

      {/* 1. HOME SCREEN */}
      {screen==="home" && (
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={14}/> THE ULTIMATE MULTIPLAYER BLUFFING GAME</div>
            <h1>One word.<br/>One <em>traitor.</em><br/>Trust no one.</h1>
            <p className="hero-sub">
              Everyone knows the secret word except one player. Ask questions, blend in, vote out the bluffer, or rescue your allies with shields in Advanced Mode!
            </p>
            <div className="hero-actions">
              <button className="btn primary large" onClick={()=>setScreen("setup")}>Create a game <ArrowRight size={18}/></button>
              <button className="btn secondary large" onClick={()=>setScreen("join")}>Join a game <Link2 size={17}/></button>
            </div>
            <div className="hero-meta">
              <span><Users size={15}/> 3–20 players</span>
              <span><Shield size={15}/> Classic & Advanced Mode</span>
              <span><LockKeyhole size={15}/> No account needed</span>
            </div>
          </div>
          <div className="game-art">
            <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
            <div className="art-card card-back"><span className="card-symbol">?</span><span className="card-label">UNKNOWN</span></div>
            <div className="art-card card-front"><div className="mask">◉</div><span className="card-label">THE TRAITOR</span><span className="card-tag">BLEND IN.</span></div>
            <div className="floating-chip chip-top"><span className="mini-dot"/> 1 IMPOSTER AMONG YOU</div>
            <div className="floating-chip chip-bottom"><Shield size={15}/> RESCUE SHIELD ACTIVE</div>
          </div>
          <div className="how-strip">
            <div><span className="step-num">01</span><b>Gather your crew</b><small>Share link or scan QR code</small></div>
            <div><span className="step-num">02</span><b>Get your secret</b><small>One traitor gets no word</small></div>
            <div><span className="step-num">03</span><b>Survive & Expose</b><small>Vote, shield allies, catch the bluffer</small></div>
          </div>
          <footer className="footer"><span>BUILT FOR GAME NIGHTS</span><span>NO DOWNLOAD · PURE REALTIME DECEPTION</span></footer>
        </section>
      )}

      {/* 2. SETUP SCREEN */}
      {screen==="setup" && (
        <section className="panel-wrap">
          <button className="back" onClick={()=>setScreen("home")}><ArrowLeft size={16}/> Back</button>
          <div className="panel">
            <div className="panel-heading">
              <div className="eyebrow">01 / SET THE SCENE</div>
              <h2>Build your <em>lobby.</em></h2>
              <p>Configure room size, duration, category, and game rules.</p>
            </div>

            <label className="field-label">YOUR NAME</label>
            <input className="field" placeholder="e.g. Onkar" value={name} onChange={e=>setName(e.target.value)} maxLength={24}/>

            <label className="field-label">GAME MODE</label>
            <div className="mode-toggle">
              <button type="button" className={gameMode==="basic"?"active":""} onClick={()=>setGameMode("basic")}>
                <b><Ghost size={14}/> Classic Mode</b>
                <small>Single round vote-out. Fast & simple.</small>
              </button>
              <button type="button" className={gameMode==="advanced"?"active":""} onClick={()=>setGameMode("advanced")}>
                <b><Swords size={14}/> Advanced Mode</b>
                <small>Multi-round, rescue shields (≥5 players), traitor assassinations!</small>
              </button>
            </div>

            <div className="field-row">
              <div className="field-col">
                <label className="field-label">MAX PLAYERS <b>{maxPlayers}</b></label>
                <input className="range" type="range" min="3" max="20" value={maxPlayers} onChange={e=>setMaxPlayers(+e.target.value)}/>
                <div className="range-labels"><span>3 players</span><span>20 players</span></div>
              </div>
              <div className="field-col">
                <label className="field-label">ROUND TIME</label>
                <div className="segmented">
                  <button className={duration===8?"active":""} onClick={()=>setDuration(8)}>8 min</button>
                  <button className={duration===10?"active":""} onClick={()=>setDuration(10)}>10 min</button>
                </div>
              </div>
            </div>

            {gameMode==="basic" ? (
              <>
                <label className="field-label">SECRET WORD CATEGORY</label>
                <div className="category-grid">
                  {categories.map((c,i)=>(
                    <button key={c} className={`category ${category===c?"selected":""}`} onClick={()=>setCategory(c)}>
                      <span>{["⌖","◈","✦","⚽","🏏","▣","◎","🐾","🎬","💥"][i]}</span>
                      {c}{category===c&&<Check size={14}/>}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="notice">
                <Shuffle size={17}/>
                <span>
                  <b>Random Categories Every Round</b>
                  <small>In Advanced Mode, categories shuffle automatically each round so the traitor must adapt!</small>
                </span>
              </div>
            )}

            <button className="btn primary full" onClick={createRoom}>Create private lobby <ArrowRight size={18}/></button>
            <p className="fine-print"><LockKeyhole size={12}/> Invite links expire after 10 minutes</p>
          </div>
        </section>
      )}

      {/* 3. JOIN SCREEN */}
      {screen==="join" && (
        <section className="panel-wrap">
          <button className="back" onClick={()=>setScreen("home")}><ArrowLeft size={16}/> Back</button>
          <div className="panel">
            <div className="panel-heading">
              <div className="eyebrow">SUMMONED TO PLAY</div>
              <h2>Join the <em>game.</em></h2>
              <p>Enter your display name and the 6-character room code.</p>
            </div>
            <label className="field-label">YOUR NAME</label>
            <input className="field" placeholder="What should we call you?" value={joinedName} onChange={e=>setJoinedName(e.target.value)} maxLength={24}/>
            <label className="field-label">ROOM CODE</label>
            <input className="field code-field" placeholder="E.G. X7K2QP" value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} maxLength={6}/>
            <button className="btn primary full" onClick={joinGame}>Join lobby <ArrowRight size={18}/></button>
          </div>
        </section>
      )}

      {/* 4. LOBBY SCREEN */}
      {screen==="lobby" && (
        <section className="panel-wrap wide">
          <button className="back" onClick={()=>void leaveLobby()}><ArrowLeft size={16}/> {isHost?"Destroy lobby":"Leave lobby"}</button>
          <div className="lobby-head">
            <div>
              <div className="eyebrow">LOBBY / WAITING FOR CREW</div>
              <h2>Bring your <em>people.</em></h2>
              <p>Mode: <b>{gameMode==="advanced"?"Advanced (Multi-round + Shields)":"Classic"}</b> · Min 3 players</p>
            </div>
            <div className="room-badge">
              <small>ROOM CODE</small>
              <b>{roomCode}</b>
              <button onClick={copyLink}><Copy size={13}/> Copy invite link</button>
            </div>
          </div>

          <div className="lobby-layout">
            <div className="roster">
              <div className="roster-top">
                <b><Users size={16}/> Players in lobby</b>
                <span>{players.length} / {maxPlayers}</span>
              </div>
              {players.map((p,i)=>(
                <div className={`player-row ${p.alive===false?"dead":""}`} key={p.id}>
                  <div className={`avatar av${i%6}`}>{p.name.slice(0,1).toUpperCase()}</div>
                  <span>
                    {p.name}
                    {p.host&&<small className="host-label">HOST</small>}
                  </span>
                  {p.host&&<Crown size={15} className="crown"/>}
                </div>
              ))}
              <div className="roster-note"><CircleHelp size={14}/> At least 3 players required to start.</div>
            </div>

            <div className="invite-card">
              <div className="invite-top"><b>Scan to Join</b><span className="expire"><span className="mini-dot"/> ACTIVE · 10 MIN</span></div>
              <div className="qr-wrap">
                <QRCodeSVG value={shareUrl||`https://traitors-game.netlify.app/?join=${roomCode}`} size={142} bgColor="#ffffff" fgColor="#16151d" level="M"/>
              </div>
              <p>Point phone camera to join instantly</p>
              <div className="share-url">
                <span>{shareUrl||`/?join=${roomCode}`}</span>
                <button onClick={copyLink}><Copy size={14}/></button>
              </div>
            </div>
          </div>

          {isHost ? (
            <button className="btn primary full start-btn" onClick={startGame} disabled={players.length<3}>
              Start game ({players.length}/3 required) <ArrowRight size={18}/>
            </button>
          ) : (
            <p className="fine-print" style={{marginTop:20}}>Waiting for host <b>{hostName}</b> to start the game...</p>
          )}
        </section>
      )}

      {/* 5. ROLE SCREEN */}
      {screen==="role" && (
        <section className="role-screen">
          <div className="eyebrow">{gameMode==="advanced"?`ROUND ${round} / YOUR SECRET CARD`:"YOUR ROLE IS SECRET"}</div>
          <h2>Look at your <em>card.</em></h2>
          <p>Don't let anyone else see your screen.</p>
          <button className={`secret-card ${showWord?"revealed":""}`} onClick={()=>setShowWord(v=>!v)}>
            <span className="secret-top"><span>TRAITORS / SECRET CARD</span><Eye size={15}/></span>
            {showWord ? (
              <>
                <span className="secret-symbol">{isTraitor?"♟":"✦"}</span>
                <small>YOUR SECRET {isTraitor?"ROLE":"WORD"}</small>
                <strong>{isTraitor?"YOU ARE THE TRAITOR":word}</strong>
                <span className="secret-bottom">{isTraitor?"Blend in. Act like you know the word.":"Keep this word secret from the traitor."}</span>
              </>
            ) : (
              <>
                <span className="secret-symbol">?</span>
                <strong>TAP TO REVEAL</strong>
                <span className="secret-bottom">Make sure nobody is looking.</span>
              </>
            )}
          </button>
          <div className="role-warning"><LockKeyhole size={16}/> Keep your role to yourself. The game depends on it.</div>
          <button className="btn primary" onClick={startRound}>I&apos;m ready <ArrowRight size={18}/></button>
        </section>
      )}

      {/* 6. GAME DISCUSSION & CHAT SCREEN */}
      {screen==="game" && (
        <section className="panel-wrap wide chat-game-wrap">
          <div className="game-topline">
            <span className="eyebrow">
              <span className="mini-dot"/> {gameMode==="advanced"?`ROUND ${round} / DISCUSSION`:"DISCUSSION PHASE"}
            </span>
            <div className="timer"><Timer size={17}/>{fmt(seconds)}</div>
          </div>

          {/* Previous round activity feed */}
          {round > 1 && (
            <div style={{marginTop: 10}}>
              {lastVotedPlayerName ? (
                <div className="round-event-card voted">
                  <Skull size={18}/>
                  <div>
                    <b>Round {round - 1} Vote: {lastVotedPlayerName} was voted out!</b>
                    <small>The crew eliminated an innocent player. The Traitor survived!</small>
                  </div>
                </div>
              ) : (
                <div className="round-event-card tied">
                  <AlertTriangle size={18}/>
                  <div>
                    <b>Round {round - 1} Vote: Stalemate!</b>
                    <small>Votes were tied or inconclusive. Nobody was voted out — the Traitor survived!</small>
                  </div>
                </div>
              )}
              {lastKilledPlayerName ? (
                <div className="round-event-card killed">
                  <Skull size={18}/>
                  <div>
                    <b>Night Strike: {lastKilledPlayerName} was assassinated by the Traitor!</b>
                    <small>They were not shielded and are now eliminated.</small>
                  </div>
                </div>
              ) : (
                <div className="round-event-card shielded">
                  <ShieldCheck size={18}/>
                  <div>
                    <b>Night Strike BLOCKED!</b>
                    <small>The Traitor attacked a shielded player. The rescue shield saved them!</small>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="chat-game-heading">
            <div>
              <h2>Read between<br/>the <em>lines.</em></h2>
              <p>Discuss clues in real time. Alive players: <b>{alivePlayers.length}</b></p>
            </div>
            <div className="chat-online-badge">
              <Wifi size={15}/>
              <span><b>{chatConnected?"LIVE":"CONNECTING"}</b><small>Room chat</small></span>
            </div>
          </div>

          <div className="chat-tabs">
            <button className={chatTab==="chat"?"active":""} onClick={()=>{setChatTab("chat");setChatUnread(0);}}>
              <MessageCircle size={16}/> Live chat {chatUnread>0&&<span className="unread-badge">{chatUnread}</span>}
            </button>
            <button className={chatTab==="discussion"?"active":""} onClick={()=>setChatTab("discussion")}>
              <Volume2 size={16}/> Tips & Clues
            </button>
          </div>

          {chatTab==="chat" ? (
            <div className="chat-panel">
              <div className="chat-panel-head">
                <div><b><UsersRound size={16}/> Room conversation</b><small>Visible to all players</small></div>
                <span className="chat-count">{alivePlayers.length} ALIVE</span>
              </div>
              <div className="chat-messages">
                {chatMessages.length===0 ? (
                  <div className="chat-empty">
                    <div className="chat-empty-icon"><MessageCircle size={24}/></div>
                    <b>Break the silence.</b>
                    <p>Send a subtle clue or ask someone a question!</p>
                  </div>
                ) : (
                  chatMessages.map(m=>(
                    <div key={m.id} className={`chat-message ${m.playerId===playerId?"mine":""}`}>
                      <div className="avatar av1">{m.name.slice(0,1).toUpperCase()}</div>
                      <div className="chat-message-content">
                        <div className="chat-message-meta">
                          <b>{m.name}{m.playerId===playerId&&<span className="you-label">YOU</span>}</b>
                          <time>{new Date(m.sentAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time>
                        </div>
                        <div className="chat-bubble">{m.text}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <form className="chat-composer" onSubmit={e=>{e.preventDefault();void sendChatMessage();}}>
                <input value={chatDraft} onChange={e=>setChatDraft(e.target.value)} placeholder="Type a subtle clue or question..." maxLength={500}/>
                <button type="submit" disabled={!chatDraft.trim()}><Send size={17}/></button>
              </form>
            </div>
          ) : (
            <div className="tip-grid">
              <div><span>01</span><b>Ask smart questions</b><p>What does it feel like? Where would you see it?</p></div>
              <div><span>02</span><b>Watch for hesitation</b><p>The traitor has no idea what the word is.</p></div>
              <div><span>03</span><b>Never give it away</b><p>Don't make it so obvious that the traitor guesses it.</p></div>
            </div>
          )}

          <button className="btn primary full" onClick={()=>setScreen("vote")}>
            <Vote size={18}/> Ready to vote
          </button>
        </section>
      )}

      {/* 7. VOTE SCREEN */}
      {screen==="vote" && (
        <section className="panel-wrap">
          <div className="panel-heading">
            <div className="eyebrow">{gameMode==="advanced"?`ROUND ${round} / ELIMINATION VOTE`:"FINAL DECISION"}</div>
            <h2>Who is the <em>traitor?</em></h2>
            <p>Pick the player you suspect is bluffing. A decisive majority is required to unmask the Traitor.</p>
          </div>

          <div className="vote-progress">
            <span>VOTING PROGRESS</span>
            <b>{votesCast} / {alivePlayers.length} VOTED</b>
          </div>

          {hasVoted ? (
            <div className="vote-status-card">
              <Check size={22}/>
              <div>
                <b>Vote locked in!</b>
                <p>Waiting for other players to submit their votes ({votesCast}/{alivePlayers.length} ready)...</p>
              </div>
            </div>
          ) : (
            <>
              <div className="vote-list">
                {alivePlayers.map(p=>(
                  <button 
                    key={p.id} 
                    className={`vote-player ${selectedVote===p.id?"vote-selected":""}`} 
                    onClick={()=>setSelectedVote(p.id)}
                  >
                    <div className="avatar av2">{p.name.slice(0,1).toUpperCase()}</div>
                    <span>{p.name}{p.id===playerId&&" (You)"}</span>
                    <span className="vote-radio">{selectedVote===p.id&&<Check size={14}/>}</span>
                  </button>
                ))}
              </div>

              <button className="btn primary full" onClick={submitVote}>
                <Vote size={18}/> Lock in vote
              </button>
            </>
          )}

          {isHost && (
            <button className="btn secondary full" onClick={forceResolveVote} style={{marginTop: 12}}>
              Host: Tally votes now ({votesCast}/{alivePlayers.length})
            </button>
          )}
        </section>
      )}

      {/* 8. VOTE RESULT SCREEN (Advanced Mode) */}
      {screen==="vote_result" && (
        <section className="panel-wrap">
          <div className="panel-heading">
            <div className="eyebrow">ROUND {round} / VOTE RESOLVED</div>
            <h2>The crew has <em>spoken.</em></h2>
            <p>Here is who was voted out this round.</p>
          </div>

          {lastVotedOutId ? (
            <div className="kill-box">
              <Skull size={28}/>
              <div>
                <b>{players.find(p=>p.id===lastVotedOutId)?.name || "A player"} was voted out!</b>
                <p>They were an <b>Innocent</b> player. The Traitor is still among you!</p>
              </div>
            </div>
          ) : (
            <div className="deadlock-box">
              <AlertTriangle size={28}/>
              <div>
                <b>⚖️ Stalemate — Vote Was Tied!</b>
                <p>The crew was divided and could not agree on a clear majority. <b>Nobody was eliminated.</b> The Traitor slipped away in the confusion!</p>
              </div>
            </div>
          )}

          {alivePlayers.length >= 5 ? (
            <div className="shield-box">
              <ShieldCheck size={28}/>
              <div>
                <b>Rescue Shield Available!</b>
                <p>Since there are {alivePlayers.length} alive players remaining, the crew can vote to rescue 1 player from the Traitor&apos;s kill.</p>
              </div>
            </div>
          ) : (
            <div className="notice">
              <AlertTriangle size={20}/>
              <span>
                <b>No Shield This Round</b>
                <small>Fewer than 5 players remaining ({alivePlayers.length} alive). Straight to Traitor kill phase!</small>
              </span>
            </div>
          )}

          <button className="btn primary full" onClick={advanceFromVoteResult}>
            Continue to next phase <ArrowRight size={18}/>
          </button>
        </section>
      )}

      {/* 9. SHIELD RESCUE PHASE (Advanced Mode, >=5 players) */}
      {screen==="shield" && (
        <section className="panel-wrap">
          <div className="panel-heading">
            <div className="eyebrow"><Shield size={14}/> RESCUE SHIELD PHASE</div>
            <h2>Protect an <em>ally.</em></h2>
            <p>Vote for one player to receive the immunity shield against the Traitor&apos;s kill tonight.</p>
          </div>

          <div className="vote-progress">
            <span>SHIELD VOTES</span>
            <b>{shieldVotesCast} / {Math.max(1, alivePlayers.length - 1)} INNOCENTS VOTED</b>
          </div>

          {isTraitor ? (
            <div className="kill-box">
              <LockKeyhole size={24}/>
              <div>
                <b>You are the Traitor</b>
                <p>You cannot grant shields. Waiting for innocents to vote ({shieldVotesCast}/{Math.max(1, alivePlayers.length - 1)} ready)...</p>
              </div>
            </div>
          ) : hasShieldVoted ? (
            <div className="vote-status-card">
              <ShieldCheck size={22}/>
              <div>
                <b>Shield vote locked in!</b>
                <p>Waiting for fellow innocents to vote ({shieldVotesCast}/{Math.max(1, alivePlayers.length - 1)} ready)...</p>
              </div>
            </div>
          ) : (
            <>
              <div className="vote-list">
                {alivePlayers.map(p=>(
                  <button 
                    key={p.id} 
                    className={`vote-player ${selectedShield===p.id?"vote-selected":""}`} 
                    onClick={()=>setSelectedShield(p.id)}
                  >
                    <div className="avatar av3">{p.name.slice(0,1).toUpperCase()}</div>
                    <span>{p.name}{p.id===playerId&&" (Self)"}</span>
                    <span className="vote-radio">{selectedShield===p.id&&<Check size={14}/>}</span>
                  </button>
                ))}
              </div>
              <button className="btn primary full" onClick={submitShield}>
                <ShieldCheck size={18}/> Grant Rescue Shield
              </button>
            </>
          )}

          {isHost && (
            <button className="btn secondary full" onClick={forceResolveShield} style={{marginTop: 12}}>
              Host: Grant shield now ({shieldVotesCast}/{Math.max(1, alivePlayers.length - 1)})
            </button>
          )}
        </section>
      )}

      {/* 10. TRAITOR KILL PHASE (Advanced Mode) */}
      {screen==="kill" && (
        <section className="panel-wrap">
          <div className="panel-heading">
            <div className="eyebrow"><Skull size={14}/> NIGHTFALL / TRAITOR KILL</div>
            <h2>The shadows <em>move.</em></h2>
            <p>One player is targeted tonight.</p>
          </div>

          {isTraitor ? (
            <>
              <div className="kill-box">
                <Skull size={24}/>
                <div>
                  <b>Traitor Night Strike</b>
                  <p>Select an innocent player to eliminate. If they were granted the rescue shield, your kill will be blocked!</p>
                </div>
              </div>

              <div className="vote-list">
                {alivePlayers.filter(p=>p.id!==playerId).map(p=>(
                  <button 
                    key={p.id} 
                    className={`vote-player ${selectedKill===p.id?"vote-selected":""}`} 
                    onClick={()=>setSelectedKill(p.id)}
                  >
                    <div className="avatar av4">{p.name.slice(0,1).toUpperCase()}</div>
                    <span>{p.name}</span>
                    <span className="vote-radio">{selectedKill===p.id&&<Check size={14}/>}</span>
                  </button>
                ))}
              </div>

              <button className="btn primary full" onClick={submitKill}>
                <Skull size={18}/> Execute Kill
              </button>
            </>
          ) : (
            <div className="notice" style={{padding:30,textAlign:"center"}}>
              <Ghost size={36} style={{margin:"0 auto 12px",color:"var(--lime)"}}/>
              <b>The Traitor is choosing a target...</b>
              <small>Stay quiet. If you were granted the shield, you will survive any attack tonight!</small>
            </div>
          )}
        </section>
      )}

      {/* 11. REVEAL / GAME OVER SCREEN */}
      {screen==="reveal" && (
        <section className="reveal-screen">
          <div className="eyebrow"><Sparkles size={14}/> GAME CONCLUDED</div>
          <div className="reveal-orb">
            {winner==="innocents" ? <Trophy size={46}/> : <Skull size={46}/>}
          </div>

          <h2>
            {winner==="innocents" ? (
              <>Innocents <em>Win!</em></>
            ) : (
              <>The Traitor <em>Wins!</em></>
            )}
          </h2>

          <div className={`winner-banner ${winner==="traitor"?"traitor":"innocents"}`}>
            <h3>{winner==="traitor" ? "🔴 Traitor Victory!" : "🟢 Innocents Victory!"}</h3>
            <p>
              {winner==="traitor" 
                ? `${traitorName} successfully deceived the crew and survived until the 1 vs 1 showdown!`
                : `The crew correctly unmasked ${traitorName} and voted them out!`
              }
            </p>
          </div>

          <div className="result-word">
            <small>THE ACTUAL TRAITOR</small>
            <b>{traitorName} ({winner==="traitor" ? "WINNER 🏆" : "DEFEATED ❌"})</b>
            <div style={{height:1,background:"#2e2b3b",margin:"14px 0"}}/>
            <small>THE SECRET WORD</small>
            <b>{word || "HIDDEN"}</b>
          </div>

          <button className="btn primary full" onClick={reset}>
            <Shuffle size={17}/> Play another game
          </button>
          <button className="btn text-btn full" onClick={()=>setScreen("lobby")}>
            Back to lobby
          </button>
        </section>
      )}

      {toast && (
        <div className="toast">
          <Zap size={15}/>{toast}
          <button onClick={()=>setToast("")}><X size={14}/></button>
        </div>
      )}
    </main>
  );
}
