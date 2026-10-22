 "use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ensureAnonymousSession, getSupabase } from "../lib/supabase";
import { ArrowRight, ArrowLeft, Copy, Crown, Eye, EyeOff, Link2, LockKeyhole, Plus, Shield, Sparkles, Timer, Users, Vote, X, Check, Volume2, Shuffle, Ghost, CircleHelp, Zap, MessageCircle, Send, Wifi, UsersRound } from "lucide-react";

type Screen = "home" | "setup" | "join" | "lobby" | "role" | "game" | "vote" | "reveal";
type Player = { id:string; name:string; host?:boolean; traitor?:boolean; alive?:boolean };
type ChatMessage = { id:string; playerId:string; name:string; text:string; sentAt:string };
const normalizeChatMessage = (value:any):ChatMessage => ({ id:String(value.id), playerId:String(value.player_id ?? value.playerId), name:String(value.name ?? "Player"), text:String(value.text ?? value.message_text ?? ""), sentAt:String(value.sent_at ?? value.sentAt ?? value.created_at ?? new Date().toISOString()) });
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
const makeCode = () => Math.random().toString(36).slice(2,8).toUpperCase();

// The cookie stores only lobby pointers, never Supabase access/refresh tokens.
// Supabase Auth separately persists the anonymous identity in the browser.
const LOBBY_COOKIE = "traitors_lobby_session";
type SavedLobbySession = { roomId: string; playerId: string };
const saveLobbySession = (roomId: string, playerId: string) => {
  if (typeof document === "undefined" || !roomId || !playerId) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const value = encodeURIComponent(JSON.stringify({ roomId, playerId }));
  // 400 days: keep the room pointer available for long-running games.
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
  } catch {
    // A malformed/stale cookie is not a valid session pointer.
  }
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
  const [roomCode,setRoomCode] = useState("");
  const [roomId,setRoomId] = useState("");
  const [playerId,setPlayerId] = useState("");
  const [isHost,setIsHost] = useState(false);
  const [players,setPlayers] = useState<Player[]>([]);
  const [word,setWord] = useState("");
  const [isTraitor,setIsTraitor] = useState(false);
  const [showWord,setShowWord] = useState(false);
  const [copied,setCopied] = useState(false);
  const [seconds,setSeconds] = useState(0);
  const [votes,setVotes] = useState<Record<string,string>>({});
  const [selectedVote,setSelectedVote] = useState("");
  const [toast,setToast] = useState("");
  const [round,setRound] = useState(1);
  const [joinCode,setJoinCode] = useState("");
  const [joinedName,setJoinedName] = useState("");
  const [traitorId,setTraitorId] = useState("");
  const [showQr,setShowQr] = useState(false);
  const [chatMessages,setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft,setChatDraft] = useState("");
  const [chatTab,setChatTab] = useState<"discussion"|"chat">("chat");
  const [chatConnected,setChatConnected] = useState(false);
  const [chatUnread,setChatUnread] = useState(0);
  const chatChannelRef = useRef<any>(null);
  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}/?join=${roomCode}` : "";
  useEffect(()=>{ if(!toast) return; const t=setTimeout(()=>setToast(""),2600); return ()=>clearTimeout(t); },[toast]);
  useEffect(()=>{ if(screen!=="game" || seconds<=0) return; const t=setTimeout(()=>setSeconds(s=>s-1),1000); return ()=>clearTimeout(t); },[screen,seconds]);
  useEffect(()=>{ if(screen==="game" && seconds===0) setScreen("vote"); },[screen,seconds]);

  const createRoom=async()=>{
    try {
      if(!name.trim()){setToast("Enter your name first");return;}
      const supabase=getSupabase(); await ensureAnonymousSession();
      const {data,error}=await supabase.rpc("traitor_create_room",{p_name:name.trim(),p_max_players:maxPlayers,p_duration:duration,p_category:category});
      if(error) throw error; const r=data as any;
      saveLobbySession(r.room_id, r.player_id);
      setRoomId(r.room_id); setRoomCode(r.code); setPlayerId(r.player_id); setIsHost(true); setHostName(name.trim());
      setPlayers((r.players||[]).map((p:any)=>({id:p.id,name:p.name,host:p.host,alive:true}))); setScreen("lobby");
    } catch(e:any){setToast(e?.message||"Could not create room. Check Supabase setup.");}
  };
  const addDemoPlayer=()=>setToast("Demo players are disabled. Share the invite link so real players can join.");
  const startGame=async()=>{
    if(players.length<3){setToast("You need at least 3 real players to start");return;}
    try {const supabase=getSupabase(); const {error}=await supabase.rpc("traitor_start_game",{p_room_id:roomId}); if(error) throw error; const {data, error:roleError}=await supabase.rpc("traitor_my_role",{p_room_id:roomId}); if(roleError) throw roleError; const r=data as any; setTraitorId(r.traitor_player_id); setIsTraitor(!!r.is_traitor); setWord(r.word||""); setShowWord(false); setSeconds(r.phase_ends_at?Math.max(0,Math.floor((new Date(r.phase_ends_at).getTime()-Date.now())/1000)):duration*60); setScreen("role");}
    catch(e:any){setToast(e?.message||"Could not start the game.");}
  };
  const joinGame=async()=>{
    if(!joinedName.trim()){setToast("Enter your name to join");return;} if(joinCode.trim().length<4){setToast("Enter a valid room code");return;}
    try {const supabase=getSupabase(); await ensureAnonymousSession(); const {data,error}=await supabase.rpc("traitor_join_room",{p_code:joinCode.trim().toUpperCase(),p_name:joinedName.trim()}); if(error) throw error; const r=data as any; saveLobbySession(r.room_id, r.player_id); setRoomId(r.room_id);setRoomCode(r.code);setPlayerId(r.player_id);setIsHost(false);setName(joinedName.trim());setHostName("Game host");setScreen("lobby"); await refreshRoom(r.room_id);}
    catch(e:any){setToast(e?.message||"Could not join room.");}
  };
  const refreshRoom=async(id:string)=>{try{const {data,error}=await getSupabase().rpc("traitor_room_state",{p_room_id:id});if(error)throw error;const r=data as any;setPlayers((r.players||[]).map((p:any)=>({id:p.id,name:p.name,host:p.host,alive:true})));setRoomCode(r.code);setMaxPlayers(r.max_players);setDuration(r.duration_minutes);setCategory(r.category);if(r.status!=="lobby"&&r.status!=="revealed"){const {data:role}=await getSupabase().rpc("traitor_my_role",{p_room_id:id});if(role){setIsTraitor(!!(role as any).is_traitor);setWord((role as any).word||"");setTraitorId((role as any).traitor_player_id||"");setSeconds(Math.max(0,Math.floor((new Date((role as any).phase_ends_at).getTime()-Date.now())/1000)));if(screen==="lobby")setScreen("role");}}if(r.status==="revealed"){const {data:result}=await getSupabase().rpc("traitor_reveal",{p_room_id:id});if(result){setWord((result as any).word||"");setTraitorId((result as any).traitor_player_id||"");setScreen("reveal");}}}catch(e:any){const message=String(e?.message||"");if(message.toLowerCase().includes("not a member of this room")||message.toLowerCase().includes("room not found")){setChatMessages([]);setChatDraft("");reset();setToast("This lobby was destroyed or is no longer available.");return;}setToast(message||"Could not refresh room state.");}};
  useEffect(()=>{if(!roomId)return; const supabase=getSupabase(); const channel=supabase.channel(`room-${roomId}`).on("postgres_changes",{event:"*",schema:"public",table:"traitor_players",filter:`room_id=eq.${roomId}`},()=>{void refreshRoom(roomId);}).subscribe(); const poll=window.setInterval(()=>{void refreshRoom(roomId);},3000); return()=>{window.clearInterval(poll);void supabase.removeChannel(channel);};},[roomId,screen]);
  useEffect(()=>{
    if(!roomId || !playerId) return;
    const supabase=getSupabase();
    let active=true;
    const channel=supabase.channel(`traitor-chat-${roomId}`)
      .on("postgres_changes", { event:"INSERT", schema:"public", table:"traitor_chat_messages", filter:`room_id=eq.${roomId}` }, async (payload)=>{
        // Refresh through the membership-checked RPC so names come from the database, not client payloads.
        const {data,error}=await supabase.rpc("traitor_chat_history", {p_room_id:roomId});
        if(error || !active || !Array.isArray(data)) return;
        const messages=(data as any[]).map(normalizeChatMessage);
        setChatMessages(messages.slice(-150));
        if(payload.new && (payload.new as any).player_id!==playerId) setChatUnread(count=>screen==="game" && chatTab==="chat" ? count : count+1);
      })
      .subscribe(async status=>{
        setChatConnected(status==="SUBSCRIBED");
        if(status==="SUBSCRIBED") {
          chatChannelRef.current=channel;
          const {data,error}=await supabase.rpc("traitor_chat_history", {p_room_id:roomId});
          if(!error && active && Array.isArray(data)) setChatMessages((data as any[]).map(normalizeChatMessage).slice(-150));
        }
      });
    return ()=>{active=false;setChatConnected(false);chatChannelRef.current=null;void supabase.removeChannel(channel);};
  },[roomId,playerId,screen,chatTab]);
  const sendChatMessage=async()=>{
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
  const startRound=async()=>{
    let remaining=duration*60;
    if(roomId){
      const {data,error}=await getSupabase().rpc("traitor_room_state",{p_room_id:roomId});
      const endTime=(data as any)?.phase_ends_at;
      if(!error && endTime) remaining=Math.max(0,Math.floor((new Date(endTime).getTime()-Date.now())/1000));
    }
    setSeconds(remaining);setChatTab("chat");setChatUnread(0);setScreen(remaining===0?"vote":"game");
  };
  const submitVote=async()=>{if(!selectedVote){setToast("Choose who you suspect");return;} try{const {error}=await getSupabase().rpc("traitor_cast_vote",{p_room_id:roomId,p_target_player_id:selectedVote});if(error)throw error;setVotes(v=>({...v,[playerId]:selectedVote}));const {data,error:revealError}=await getSupabase().rpc("traitor_reveal",{p_room_id:roomId});if(!revealError&&data){setWord((data as any).word||word);setTraitorId((data as any).traitor_player_id||traitorId);setScreen("reveal");}else setToast("Vote saved. Waiting for other players to vote.");}catch(e:any){setToast(e?.message||"Could not submit vote.");}};
  const leaveLobby=async()=>{
    if(!roomId){reset();return;}
    if(isHost){
      const confirmed=window.confirm("Destroy this lobby for everyone? All players, votes, and chat history will be deleted.");
      if(!confirmed) return;
      try { const {error}=await getSupabase().rpc("traitor_destroy_room", {p_room_id:roomId}); if(error) throw error; setToast("Lobby and chat history deleted"); }
      catch(e:any){setToast(e?.message||"Could not destroy lobby");return;}
    }
    setChatMessages([]);setChatDraft("");reset();
  };
  const reset=()=>{clearLobbySession();setScreen("home");setPlayers([]);setRoomCode("");setRoomId("");setPlayerId("");setIsHost(false);setWord("");setIsTraitor(false);setTraitorId("");setSeconds(0);setVotes({});setSelectedVote("");setRound(1);setChatMessages([]);setChatDraft("");setChatUnread(0);};
  useEffect(()=>{
    let active=true;
    const restoreLobby=async()=>{
      const requestedCode=typeof window!=="undefined" ? new URLSearchParams(window.location.search).get("join") : null;
      const saved=readLobbySession();
      if(!saved){
        if(requestedCode){setJoinCode(requestedCode.toUpperCase());setScreen("join");}
        return;
      }
      const openJoinPage=()=>{ if(requestedCode){setJoinCode(requestedCode.toUpperCase());setScreen("join");} };
      try {
        const supabase=getSupabase();
        await ensureAnonymousSession();
        const {data,error}=await supabase.rpc("traitor_room_state",{p_room_id:saved.roomId});
        if(error) {
          const message=String(error.message||"").toLowerCase();
          if(message.includes("not a member")||message.includes("room not found")||message.includes("does not exist")){
            clearLobbySession(); openJoinPage();
            if(!requestedCode && active) setToast("This lobby was deleted or your membership has ended.");
            return;
          }
          if(active) setToast("Could not reconnect to your lobby. Your saved session is kept; check your connection and refresh.");
          return;
        }
        if(!active) return;
        const room=data as any;
        // An explicit invite URL for a different room takes priority over the saved room.
        // Keep the old cookie until joining the new room succeeds.
        if(requestedCode && String(room.code).toUpperCase()!==requestedCode.toUpperCase()){
          setJoinCode(requestedCode.toUpperCase());setScreen("join");return;
        }
        const roster=(room.players||[]).map((p:any)=>({id:String(p.id),name:String(p.name),host:!!p.host,alive:true}));
        const me=roster.find((p:Player)=>p.id===saved.playerId);
        if(!me){clearLobbySession();openJoinPage();if(!requestedCode) setToast("Your saved player is no longer in this lobby.");return;}
        setRoomId(saved.roomId);setPlayerId(saved.playerId);setRoomCode(room.code);setPlayers(roster);
        setIsHost(!!me.host);setName(me.name);setJoinedName(me.name);setHostName(roster.find((p:Player)=>p.host)?.name||"Game host");
        setMaxPlayers(room.max_players);setDuration(room.duration_minutes);setCategory(room.category);
        if(room.status==="lobby") { setScreen("lobby"); return; }
        if(room.status==="revealed") {
          const {data:result,error:resultError}=await supabase.rpc("traitor_reveal",{p_room_id:saved.roomId});
          if(resultError) throw resultError;
          if(!active) return;
          const reveal=result as any;setWord(reveal?.word||"");setTraitorId(reveal?.traitor_player_id||"");setIsTraitor(false);setScreen("reveal");return;
        }
        const {data:role,error:roleError}=await supabase.rpc("traitor_my_role",{p_room_id:saved.roomId});
        if(roleError) throw roleError;
        if(!active) return;
        const roleData=role as any;
        setIsTraitor(!!roleData.is_traitor);setWord(roleData.word||"");setTraitorId(roleData.traitor_player_id||"");setShowWord(false);
        const endTime=room.phase_ends_at||roleData.phase_ends_at;
        const remaining=endTime?Math.max(0,Math.floor((new Date(endTime).getTime()-Date.now())/1000)):0;
        setSeconds(remaining);setScreen(room.status==="voting"||remaining===0?"vote":"role");
      } catch(e:any) {
        if(active) setToast(e?.message||"Could not restore your lobby. Your saved session is kept; refresh to retry.");
      }
    };
    void restoreLobby();
    return ()=>{active=false;};
  },[]);

  const copyLink=async()=>{try{await navigator.clipboard.writeText(shareUrl);setCopied(true);setToast("Invite link copied");setTimeout(()=>setCopied(false),1800);}catch{setToast(shareUrl);}};
  const fmt=(s:number)=>`${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;
  const Progress=()=> <div className="progress"><span style={{width:({home:10,setup:30,join:25,lobby:45,role:60,game:78,vote:90,reveal:100}[screen])+"%"}}/></div>;
  return <main className="shell">
    <header className="topbar"><button className="brand" onClick={()=>void (roomId?leaveLobby():reset())}><span className="brand-icon"><Ghost size={21}/></span><span>TRAITORS<span className="brand-dot">.</span><small>TRUST NO ONE</small></span></button><div className="top-right"><span className="live-dot"/> PARTY MODE <span className="top-sep">·</span><span className="online">NO LOGIN NEEDED</span></div></header>
    <Progress/>
    {screen==="home" && <section className="hero">
      <div className="hero-copy"><div className="eyebrow"><Sparkles size={14}/> THE ULTIMATE BLUFFING GAME</div><h1>One word.<br/>One <em>traitor.</em><br/>Trust no one.</h1><p className="hero-sub">Everyone knows the secret word. Except one player. Ask questions, read the room, and expose the imposter before time runs out.</p>
      <div className="hero-actions"><button className="btn primary large" onClick={()=>setScreen("setup")}>Create a game <ArrowRight size={18}/></button><button className="btn secondary large" onClick={()=>setScreen("join")}>Join a game <Link2 size={17}/></button></div>
      <div className="hero-meta"><span><Users size={15}/> 3–20 players</span><span><Timer size={15}/> 8–10 min rounds</span><span><LockKeyhole size={15}/> No account</span></div></div>
      <div className="game-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="art-card card-back"><span className="card-symbol">?</span><span className="card-label">UNKNOWN</span></div><div className="art-card card-front"><div className="mask">◉</div><span className="card-label">THE TRAITOR</span><span className="card-tag">BLEND IN.</span></div><div className="floating-chip chip-top"><span className="mini-dot"/> 1 IMPOSTER AMONG YOU</div><div className="floating-chip chip-bottom"><Shield size={15}/> WHO CAN YOU TRUST?</div><div className="spark spark-a">✦</div><div className="spark spark-b">✧</div></div>
      <div className="how-strip"><div><span className="step-num">01</span><b>Gather your crew</b><small>Share a link or scan a QR</small></div><div><span className="step-num">02</span><b>Get your secret</b><small>One player gets nothing</small></div><div><span className="step-num">03</span><b>Find the traitor</b><small>Talk, bluff, and vote</small></div></div>
      <footer className="footer"><span>BUILT FOR GAME NIGHTS</span><span>NO DOWNLOAD · JUST DECEPTION</span></footer>
    </section>}
    {screen==="setup" && <section className="panel-wrap"><button className="back" onClick={()=>setScreen("home")}><ArrowLeft size={16}/> Back</button><div className="panel"><div className="panel-heading"><div className="eyebrow">01 / SET THE SCENE</div><h2>Build your <em>lobby.</em></h2><p>Pick your crew size, choose a category, then send out the invite.</p></div><label className="field-label">YOUR NAME</label><input className="field" placeholder="e.g. Onkar" value={name} onChange={e=>setName(e.target.value)} maxLength={24}/><div className="field-row"><div className="field-col"><label className="field-label">MAX PLAYERS <b>{maxPlayers}</b></label><input className="range" type="range" min="3" max="20" value={maxPlayers} onChange={e=>setMaxPlayers(+e.target.value)}/><div className="range-labels"><span>3 players</span><span>20 players</span></div></div><div className="field-col"><label className="field-label">ROUND TIME</label><div className="segmented"><button className={duration===8?"active":""} onClick={()=>setDuration(8)}>8 min</button><button className={duration===10?"active":""} onClick={()=>setDuration(10)}>10 min</button></div></div></div><label className="field-label">SECRET WORD CATEGORY</label><div className="category-grid">{categories.map((c,i)=><button key={c} className={`category ${category===c?"selected":""}`} onClick={()=>setCategory(c)}><span>{["⌖","◈","✦","⚽","🏏","▣","◎","🐾","🎬","💥"][i]}</span>{c}{category===c&&<Check size={14}/>}</button>)}</div><div className="notice"><Shield size={17}/><span><b>One secret. One traitor.</b><small>Everyone gets the same word except one random player.</small></span></div><button className="btn primary full" onClick={createRoom}>Create private lobby <ArrowRight size={18}/></button><p className="fine-print"><LockKeyhole size={12}/> Invite links expire after 10 minutes · First 20 players only</p></div></section>}
    {screen==="join" && <section className="panel-wrap"><button className="back" onClick={()=>setScreen("home")}><ArrowLeft size={16}/> Back</button><div className="panel"><div className="panel-heading"><div className="eyebrow">YOU'VE BEEN SUMMONED</div><h2>Join the <em>game.</em></h2><p>Enter your name and the invite code from your friend.</p></div><label className="field-label">YOUR NAME</label><input className="field" placeholder="What should we call you?" value={joinedName} onChange={e=>setJoinedName(e.target.value)} maxLength={24}/><label className="field-label">ROOM CODE</label><input className="field code-field" placeholder="E.G. X7K2QP" value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} maxLength={6}/><button className="btn primary full" onClick={joinGame}>Join lobby <ArrowRight size={18}/></button><p className="fine-print"><Timer size={12}/> Invite links expire 10 minutes after creation.</p></div></section>}
    {screen==="lobby" && <section className="panel-wrap wide"><button className="back" onClick={()=>void leaveLobby()}><ArrowLeft size={16}/> {isHost?"Destroy lobby":"Leave lobby"}</button><div className="lobby-head"><div><div className="eyebrow">LOBBY / WAITING FOR CREW</div><h2>Bring your <em>people.</em></h2><p>Everyone in? Start the game when your crew is ready.</p></div><div className="room-badge"><small>ROOM CODE</small><b>{roomCode}</b><button onClick={copyLink}><Copy size={13}/> Copy invite</button></div></div><div className="lobby-layout"><div className="roster"><div className="roster-top"><b><Users size={16}/> Players in lobby</b><span>{players.length} / {maxPlayers}</span></div>{players.map((p,i)=><div className="player-row" key={p.id}><div className={`avatar av${i%6}`}>{p.name.slice(0,1).toUpperCase()}</div><span>{p.name}{p.host&&<small className="host-label">HOST</small>}</span>{p.host&&<Crown size={15} className="crown"/>}</div>)}{players.length<maxPlayers&&<button className="add-player" onClick={addDemoPlayer}><Plus size={16}/> Add demo player <small>preview only</small></button>}<div className="roster-note"><CircleHelp size={14}/> At least 3 players required to start.</div></div><div className="invite-card"><div className="invite-top"><b>Invite your crew</b><span className="expire"><span className="mini-dot"/> LINK ACTIVE · 10 MIN</span></div><div className="qr-wrap"><QRCodeSVG value={shareUrl||`https://example.com/?join=${roomCode}`} size={142} bgColor="#ffffff" fgColor="#16151d" level="M"/></div><p>Scan to join instantly</p><div className="share-url">{shareUrl||`your-site.vercel.app/?join=${roomCode}`}<button onClick={copyLink}><Copy size={14}/></button></div><button className="btn secondary full" onClick={()=>setShowQr(v=>!v)}><Eye size={16}/> {showQr?"Hide QR details":"Show QR invite"}</button></div></div><button className="btn primary full start-btn" onClick={startGame} disabled={players.length<3}>Start game <ArrowRight size={18}/></button><p className="fine-print">Live lobby: player list syncs across devices. Run the Supabase setup SQL before deploying.</p></section>}
    {screen==="role" && <section className="role-screen"><div className="eyebrow">YOUR ROLE IS SECRET</div><h2>Look at your <em>card.</em></h2><p>Don't let anyone else see your screen.</p><button className={`secret-card ${showWord?"revealed":""}`} onClick={()=>setShowWord(v=>!v)}><span className="secret-top"><span>TRAITORS / ROLE CARD</span><Eye size={15}/></span>{showWord?<><span className="secret-symbol">{isTraitor?"♟":"✦"}</span><small>YOUR SECRET {isTraitor?"ROLE":"WORD"}</small><strong>{isTraitor?"YOU ARE THE TRAITOR":word||"TOKYO"}</strong><span className="secret-bottom">{isTraitor?"Blend in. Figure out the word.":"Keep this word secret from the traitor."}</span></>:<><span className="secret-symbol">?</span><strong>TAP TO REVEAL</strong><span className="secret-bottom">Make sure nobody is looking.</span></>}</button><div className="role-warning"><LockKeyhole size={16}/> Keep your role to yourself. The game depends on it.</div><button className="btn primary" onClick={startRound}>I'm ready <ArrowRight size={18}/></button></section>}
    {screen==="game" && <section className="panel-wrap wide chat-game-wrap"><div className="game-topline"><span className="eyebrow"><span className="mini-dot"/> ROUND {round} / LIVE DISCUSSION</span><div className="timer"><Timer size={17}/>{fmt(seconds)}</div></div><div className="chat-game-heading"><div><h2>Read between<br/>the <em>lines.</em></h2><p>Discuss clues in real time. Watch what everyone says.</p></div><div className="chat-online-badge"><Wifi size={15}/><span><b>{chatConnected?"LIVE CONNECTION":"CONNECTING"}</b><small>WebSocket chat</small></span></div></div><div className="chat-tabs"><button className={chatTab==="chat"?"active":""} onClick={()=>{setChatTab("chat");setChatUnread(0);}}><MessageCircle size={16}/> Live chat {chatUnread>0&&<span className="unread-badge">{chatUnread>9?"9+":chatUnread}</span>}</button><button className={chatTab==="discussion"?"active":""} onClick={()=>setChatTab("discussion")}><Volume2 size={16}/> Discussion tips</button></div>{chatTab==="chat"?<div className="chat-panel"><div className="chat-panel-head"><div><b><UsersRound size={16}/> Room conversation</b><small>Messages are visible to everyone in this room</small></div><span className="chat-count">{players.length} PLAYERS</span></div><div className="chat-messages" aria-live="polite">{chatMessages.length===0?<div className="chat-empty"><div className="chat-empty-icon"><MessageCircle size={24}/></div><b>Break the silence.</b><p>Send the first clue or ask a question. Keep the secret word hidden!</p><span>LIVE MESSAGES · ROOM {roomCode}</span></div>:chatMessages.map((m,i)=><div key={m.id} className={`chat-message ${m.playerId===playerId?"mine":""}`}><div className={`avatar av${Math.abs(m.playerId.split("").reduce((a,c)=>a+c.charCodeAt(0),0))%6}`}>{m.name.slice(0,1).toUpperCase()}</div><div className="chat-message-content"><div className="chat-message-meta"><b>{m.name}{m.playerId===playerId&&<span className="you-label">YOU</span>}</b><time>{new Date(m.sentAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time></div><div className="chat-bubble">{m.text}</div></div></div>)}</div><form className="chat-composer" onSubmit={e=>{e.preventDefault();void sendChatMessage();}}><input value={chatDraft} onChange={e=>setChatDraft(e.target.value)} placeholder="Type a clue or ask a question…" maxLength={500} aria-label="Chat message"/><span className="chat-char-count">{chatDraft.length}/500</span><button type="submit" disabled={!chatDraft.trim()} aria-label="Send message"><Send size={17}/></button></form><p className="chat-safety-note"><LockKeyhole size={12}/> Never type the secret word directly in chat.</p></div>:<><div className="discussion-card"><div className="discussion-icon"><Volume2 size={22}/></div><div><b>Discussion time</b><p>Take turns giving clues about your word. Don't say the word out loud.</p></div></div><div className="tip-grid"><div><span>01</span><b>Ask smart questions</b><p>What does it remind you of? Where might you find it?</p></div><div><span>02</span><b>Watch for hesitation</b><p>The traitor is trying to sound like they know.</p></div><div><span>03</span><b>Keep it subtle</b><p>Don't make the answer too obvious.</p></div></div></>}<button className="btn primary full" onClick={()=>setScreen("vote")}><Vote size={18}/> Time to vote</button><p className="fine-print">Chat history is saved only for this active lobby and is permanently deleted when the host destroys the lobby. Keep messages respectful and avoid revealing the secret word.</p></section>}
    {screen==="vote" && <section className="panel-wrap"><div className="panel-heading"><div className="eyebrow">FINAL DECISION</div><h2>Who is the <em>traitor?</em></h2><p>Trust your instincts. Pick the player you think is bluffing.</p></div><div className="vote-list">{players.map((p,i)=><button key={p.id} className={`vote-player ${selectedVote===p.id?"vote-selected":""}`} onClick={()=>setSelectedVote(p.id)}><div className={`avatar av${i%6}`}>{p.name.slice(0,1).toUpperCase()}</div><span>{p.name}{p.host&&<small className="host-label">HOST</small>}</span><span className="vote-radio">{selectedVote===p.id&&<Check size={14}/>}</span></button>)}</div><button className="btn primary full" onClick={submitVote}>Lock in vote <Vote size={18}/></button><p className="fine-print">Votes are final. Choose carefully.</p></section>}
    {screen==="reveal" && <section className="reveal-screen"><div className="eyebrow"><Sparkles size={14}/> THE TRUTH COMES OUT</div><div className="reveal-orb"><Ghost size={46}/></div><h2>The traitor<br/>was <em>{players.find(p=>p.id===traitorId)?.name||"hidden"}</em>.</h2><p>{selectedVote===traitorId?"Your instincts were right. The crew caught the bluffer.":"The truth is out. Did your crew see through the bluff?"}</p><div className="result-word"><small>THE SECRET WORD WAS</small><b>{word||"TOKYO"}</b></div><button className="btn primary full" onClick={reset}>Play another round <Shuffle size={17}/></button><button className="btn text-btn full" onClick={()=>setScreen("lobby")}>Back to lobby</button></section>}
    {toast&&<div className="toast"><Zap size={15}/>{toast}<button onClick={()=>setToast("")}><X size={14}/></button></div>}
    <div className="mobile-foot">TRAITORS<span>.</span> <small>THE GAME OF TRUST & DECEPTION</small></div>
  </main>;
}