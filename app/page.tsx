 "use client";
import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ensureAnonymousSession, getSupabase } from "../lib/supabase";
import { ArrowRight, ArrowLeft, Copy, Crown, Eye, EyeOff, Link2, LockKeyhole, Plus, Shield, Sparkles, Timer, Users, Vote, X, Check, Volume2, Shuffle, Ghost, CircleHelp, Zap } from "lucide-react";

type Screen = "home" | "setup" | "join" | "lobby" | "role" | "game" | "vote" | "reveal";
type Player = { id:string; name:string; host?:boolean; traitor?:boolean; alive?:boolean };
const WORDS = {
  Places:["Tokyo","Eiffel Tower","Grand Canyon","Mumbai","Great Barrier Reef","Taj Mahal","New York","Mount Everest","Santorini","Colosseum"],
  Brands:["Nike","LEGO","Apple","Coca-Cola","Netflix","Adidas","IKEA","Samsung","Spotify","Nintendo"],
  Anime:["Naruto","One Piece","Demon Slayer","Jujutsu Kaisen","Death Note","Dragon Ball","Attack on Titan","Pokémon"],
  Football:["Lionel Messi","Cristiano Ronaldo","Neymar Jr.","Kylian Mbappé","Erling Haaland","Sunil Chhetri"],
  Cricket:["Virat Kohli","MS Dhoni","Rohit Sharma","Jasprit Bumrah","AB de Villiers","Sachin Tendulkar"],
  Games:["Minecraft","Fortnite","GTA V","Among Us","Valorant","FIFA","Clash of Clans"],
  Countries:["Japan","Brazil","India","Iceland","Canada","Egypt","Australia","Argentina"]
};
const categories = Object.keys(WORDS);
const makeCode = () => Math.random().toString(36).slice(2,8).toUpperCase();
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
  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}/?join=${roomCode}` : "";
  useEffect(()=>{ if(!toast) return; const t=setTimeout(()=>setToast(""),2600); return ()=>clearTimeout(t); },[toast]);
  useEffect(()=>{ if(screen!=="game" || seconds<=0) return; const t=setTimeout(()=>setSeconds(s=>s-1),1000); return ()=>clearTimeout(t); },[screen,seconds]);
  useEffect(()=>{ if(screen==="game" && seconds===0) setScreen("vote"); },[screen,seconds]);
  useEffect(()=>{ if(typeof window!=="undefined"){ const code=new URLSearchParams(window.location.search).get("join"); if(code){setJoinCode(code.toUpperCase());setScreen("join");} } },[]);
  const createRoom=async()=>{
    try {
      if(!name.trim()){setToast("Enter your name first");return;}
      const supabase=getSupabase(); await ensureAnonymousSession();
      const {data,error}=await supabase.rpc("traitor_create_room",{p_name:name.trim(),p_max_players:maxPlayers,p_duration:duration,p_category:category});
      if(error) throw error; const r=data as any;
      setRoomId(r.room_id); setRoomCode(r.code); setPlayerId(r.player_id); setIsHost(true); setHostName(name.trim());
      setPlayers((r.players||[]).map((p:any)=>({id:p.id,name:p.name,host:p.host,alive:true}))); setScreen("lobby");
    } catch(e:any){setToast(e?.message||"Could not create room. Check Supabase setup.");}
  };
  const addDemoPlayer=()=>setToast("Demo players are disabled. Share the invite link so real players can join.");
  const startGame=async()=>{
    if(players.length<4){setToast("You need at least 4 real players to start");return;}
    try {const supabase=getSupabase(); const {error}=await supabase.rpc("traitor_start_game",{p_room_id:roomId}); if(error) throw error; const {data, error:roleError}=await supabase.rpc("traitor_my_role",{p_room_id:roomId}); if(roleError) throw roleError; const r=data as any; setTraitorId(r.traitor_player_id); setIsTraitor(!!r.is_traitor); setWord(r.word||""); setShowWord(false); setSeconds(duration*60); setScreen("role");}
    catch(e:any){setToast(e?.message||"Could not start the game.");}
  };
  const joinGame=async()=>{
    if(!joinedName.trim()){setToast("Enter your name to join");return;} if(joinCode.trim().length<4){setToast("Enter a valid room code");return;}
    try {const supabase=getSupabase(); await ensureAnonymousSession(); const {data,error}=await supabase.rpc("traitor_join_room",{p_code:joinCode.trim().toUpperCase(),p_name:joinedName.trim()}); if(error) throw error; const r=data as any; setRoomId(r.room_id);setRoomCode(r.code);setPlayerId(r.player_id);setIsHost(false);setName(joinedName.trim());setHostName("Game host");setScreen("lobby"); await refreshRoom(r.room_id);}
    catch(e:any){setToast(e?.message||"Could not join room.");}
  };
  const refreshRoom=async(id:string)=>{try{const {data,error}=await getSupabase().rpc("traitor_room_state",{p_room_id:id});if(error)throw error;const r=data as any;setPlayers((r.players||[]).map((p:any)=>({id:p.id,name:p.name,host:p.host,alive:true})));setRoomCode(r.code);setMaxPlayers(r.max_players);setDuration(r.duration_minutes);setCategory(r.category);if(r.status!=="lobby"&&r.status!=="revealed"){const {data:role}=await getSupabase().rpc("traitor_my_role",{p_room_id:id});if(role){setIsTraitor(!!(role as any).is_traitor);setWord((role as any).word||"");setTraitorId((role as any).traitor_player_id||"");setSeconds(Math.max(0,Math.floor((new Date((role as any).phase_ends_at).getTime()-Date.now())/1000)));if(screen==="lobby")setScreen("role");}}if(r.status==="revealed"){const {data:result}=await getSupabase().rpc("traitor_reveal",{p_room_id:id});if(result){setWord((result as any).word||"");setTraitorId((result as any).traitor_player_id||"");setScreen("reveal");}}}catch(e:any){setToast(e?.message||"Could not refresh room state.");}};
  useEffect(()=>{if(!roomId)return; const supabase=getSupabase(); const channel=supabase.channel(`room-${roomId}`).on("postgres_changes",{event:"*",schema:"public",table:"traitor_players",filter:`room_id=eq.${roomId}`},()=>{void refreshRoom(roomId);}).subscribe(); const poll=window.setInterval(()=>{void refreshRoom(roomId);},3000); return()=>{window.clearInterval(poll);void supabase.removeChannel(channel);};},[roomId,screen]);
  const startRound=()=>{setSeconds(duration*60);setScreen("game");};
  const submitVote=async()=>{if(!selectedVote){setToast("Choose who you suspect");return;} try{const {error}=await getSupabase().rpc("traitor_cast_vote",{p_room_id:roomId,p_target_player_id:selectedVote});if(error)throw error;setVotes(v=>({...v,[playerId]:selectedVote}));const {data,error:revealError}=await getSupabase().rpc("traitor_reveal",{p_room_id:roomId});if(!revealError&&data){setWord((data as any).word||word);setTraitorId((data as any).traitor_player_id||traitorId);setScreen("reveal");}else setToast("Vote saved. Waiting for other players to vote.");}catch(e:any){setToast(e?.message||"Could not submit vote.");}};
  const reset=()=>{setScreen("home");setPlayers([]);setRoomCode("");setRoomId("");setPlayerId("");setIsHost(false);setWord("");setSeconds(0);setVotes({});setSelectedVote("");setRound(1);};
  const copyLink=async()=>{try{await navigator.clipboard.writeText(shareUrl);setCopied(true);setToast("Invite link copied");setTimeout(()=>setCopied(false),1800);}catch{setToast(shareUrl);}};
  const fmt=(s:number)=>`${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;
  const Progress=()=> <div className="progress"><span style={{width:({home:10,setup:30,join:25,lobby:45,role:60,game:78,vote:90,reveal:100}[screen])+"%"}}/></div>;
  return <main className="shell">
    <header className="topbar"><button className="brand" onClick={reset}><span className="brand-icon"><Ghost size={21}/></span><span>TRAITORS<span className="brand-dot">.</span><small>TRUST NO ONE</small></span></button><div className="top-right"><span className="live-dot"/> PARTY MODE <span className="top-sep">·</span><span className="online">NO LOGIN NEEDED</span></div></header>
    <Progress/>
    {screen==="home" && <section className="hero">
      <div className="hero-copy"><div className="eyebrow"><Sparkles size={14}/> THE ULTIMATE BLUFFING GAME</div><h1>One word.<br/>One <em>traitor.</em><br/>Trust no one.</h1><p className="hero-sub">Everyone knows the secret word. Except one player. Ask questions, read the room, and expose the imposter before time runs out.</p>
      <div className="hero-actions"><button className="btn primary large" onClick={()=>setScreen("setup")}>Create a game <ArrowRight size={18}/></button><button className="btn secondary large" onClick={()=>setScreen("join")}>Join a game <Link2 size={17}/></button></div>
      <div className="hero-meta"><span><Users size={15}/> 4–20 players</span><span><Timer size={15}/> 8–10 min rounds</span><span><LockKeyhole size={15}/> No account</span></div></div>
      <div className="game-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="art-card card-back"><span className="card-symbol">?</span><span className="card-label">UNKNOWN</span></div><div className="art-card card-front"><div className="mask">◉</div><span className="card-label">THE TRAITOR</span><span className="card-tag">BLEND IN.</span></div><div className="floating-chip chip-top"><span className="mini-dot"/> 1 IMPOSTER AMONG YOU</div><div className="floating-chip chip-bottom"><Shield size={15}/> WHO CAN YOU TRUST?</div><div className="spark spark-a">✦</div><div className="spark spark-b">✧</div></div>
      <div className="how-strip"><div><span className="step-num">01</span><b>Gather your crew</b><small>Share a link or scan a QR</small></div><div><span className="step-num">02</span><b>Get your secret</b><small>One player gets nothing</small></div><div><span className="step-num">03</span><b>Find the traitor</b><small>Talk, bluff, and vote</small></div></div>
      <footer className="footer"><span>BUILT FOR GAME NIGHTS</span><span>NO DOWNLOAD · JUST DECEPTION</span></footer>
    </section>}
    {screen==="setup" && <section className="panel-wrap"><button className="back" onClick={()=>setScreen("home")}><ArrowLeft size={16}/> Back</button><div className="panel"><div className="panel-heading"><div className="eyebrow">01 / SET THE SCENE</div><h2>Build your <em>lobby.</em></h2><p>Pick your crew size, choose a category, then send out the invite.</p></div><label className="field-label">YOUR NAME</label><input className="field" placeholder="e.g. Onkar" value={name} onChange={e=>setName(e.target.value)} maxLength={24}/><div className="field-row"><div className="field-col"><label className="field-label">MAX PLAYERS <b>{maxPlayers}</b></label><input className="range" type="range" min="4" max="20" value={maxPlayers} onChange={e=>setMaxPlayers(+e.target.value)}/><div className="range-labels"><span>4 players</span><span>20 players</span></div></div><div className="field-col"><label className="field-label">ROUND TIME</label><div className="segmented"><button className={duration===8?"active":""} onClick={()=>setDuration(8)}>8 min</button><button className={duration===10?"active":""} onClick={()=>setDuration(10)}>10 min</button></div></div></div><label className="field-label">SECRET WORD CATEGORY</label><div className="category-grid">{categories.map((c,i)=><button key={c} className={`category ${category===c?"selected":""}`} onClick={()=>setCategory(c)}><span>{["⌖","◈","✦","⚽","🏏","▣","◎"][i]}</span>{c}{category===c&&<Check size={14}/>}</button>)}</div><div className="notice"><Shield size={17}/><span><b>One secret. One traitor.</b><small>Everyone gets the same word except one random player.</small></span></div><button className="btn primary full" onClick={createRoom}>Create private lobby <ArrowRight size={18}/></button><p className="fine-print"><LockKeyhole size={12}/> Invite links expire after 10 minutes · First 20 players only</p></div></section>}
    {screen==="join" && <section className="panel-wrap"><button className="back" onClick={()=>setScreen("home")}><ArrowLeft size={16}/> Back</button><div className="panel"><div className="panel-heading"><div className="eyebrow">YOU'VE BEEN SUMMONED</div><h2>Join the <em>game.</em></h2><p>Enter your name and the invite code from your friend.</p></div><label className="field-label">YOUR NAME</label><input className="field" placeholder="What should we call you?" value={joinedName} onChange={e=>setJoinedName(e.target.value)} maxLength={24}/><label className="field-label">ROOM CODE</label><input className="field code-field" placeholder="E.G. X7K2QP" value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} maxLength={6}/><button className="btn primary full" onClick={joinGame}>Join lobby <ArrowRight size={18}/></button><p className="fine-print"><Timer size={12}/> Invite links expire 10 minutes after creation.</p></div></section>}
    {screen==="lobby" && <section className="panel-wrap wide"><button className="back" onClick={()=>setScreen("home")}><ArrowLeft size={16}/> Leave lobby</button><div className="lobby-head"><div><div className="eyebrow">LOBBY / WAITING FOR CREW</div><h2>Bring your <em>people.</em></h2><p>Everyone in? Start the game when your crew is ready.</p></div><div className="room-badge"><small>ROOM CODE</small><b>{roomCode}</b><button onClick={copyLink}><Copy size={13}/> Copy invite</button></div></div><div className="lobby-layout"><div className="roster"><div className="roster-top"><b><Users size={16}/> Players in lobby</b><span>{players.length} / {maxPlayers}</span></div>{players.map((p,i)=><div className="player-row" key={p.id}><div className={`avatar av${i%6}`}>{p.name.slice(0,1).toUpperCase()}</div><span>{p.name}{p.host&&<small className="host-label">HOST</small>}</span>{p.host&&<Crown size={15} className="crown"/>}</div>)}{players.length<maxPlayers&&<button className="add-player" onClick={addDemoPlayer}><Plus size={16}/> Add demo player <small>preview only</small></button>}<div className="roster-note"><CircleHelp size={14}/> At least 4 players required to start.</div></div><div className="invite-card"><div className="invite-top"><b>Invite your crew</b><span className="expire"><span className="mini-dot"/> LINK ACTIVE · 10 MIN</span></div><div className="qr-wrap"><QRCodeSVG value={shareUrl||`https://example.com/?join=${roomCode}`} size={142} bgColor="#ffffff" fgColor="#16151d" level="M"/></div><p>Scan to join instantly</p><div className="share-url">{shareUrl||`your-site.vercel.app/?join=${roomCode}`}<button onClick={copyLink}><Copy size={14}/></button></div><button className="btn secondary full" onClick={()=>setShowQr(v=>!v)}><Eye size={16}/> {showQr?"Hide QR details":"Show QR invite"}</button></div></div><button className="btn primary full start-btn" onClick={startGame} disabled={players.length<4}>Start game <ArrowRight size={18}/></button><p className="fine-print">Live lobby: player list syncs across devices. Run the Supabase setup SQL before deploying.</p></section>}
    {screen==="role" && <section className="role-screen"><div className="eyebrow">YOUR ROLE IS SECRET</div><h2>Look at your <em>card.</em></h2><p>Don't let anyone else see your screen.</p><button className={`secret-card ${showWord?"revealed":""}`} onClick={()=>setShowWord(v=>!v)}><span className="secret-top"><span>TRAITORS / ROLE CARD</span><Eye size={15}/></span>{showWord?<><span className="secret-symbol">{isTraitor?"♟":"✦"}</span><small>YOUR SECRET {isTraitor?"ROLE":"WORD"}</small><strong>{isTraitor?"YOU ARE THE TRAITOR":word||"TOKYO"}</strong><span className="secret-bottom">{isTraitor?"Blend in. Figure out the word.":"Keep this word secret from the traitor."}</span></>:<><span className="secret-symbol">?</span><strong>TAP TO REVEAL</strong><span className="secret-bottom">Make sure nobody is looking.</span></>}</button><div className="role-warning"><LockKeyhole size={16}/> Keep your role to yourself. The game depends on it.</div><button className="btn primary" onClick={startRound}>I'm ready <ArrowRight size={18}/></button></section>}
    {screen==="game" && <section className="panel-wrap wide"><div className="game-topline"><span className="eyebrow">ROUND {round} / DISCUSSION</span><div className="timer"><Timer size={17}/>{fmt(seconds)}</div></div><div className="discussion-title"><h2>Read between<br/>the <em>lines.</em></h2><p>Ask questions. Listen closely. The traitor is improvising.</p></div><div className="discussion-card"><div className="discussion-icon"><Volume2 size={22}/></div><div><b>Discussion time</b><p>Take turns giving clues about your word. Don't say the word out loud.</p></div></div><div className="tip-grid"><div><span>01</span><b>Ask smart questions</b><p>What does it remind you of? Where might you find it?</p></div><div><span>02</span><b>Watch for hesitation</b><p>The traitor is trying to sound like they know.</p></div><div><span>03</span><b>Keep it subtle</b><p>Don't make the answer too obvious.</p></div></div><button className="btn primary full" onClick={()=>setScreen("vote")}>Time to vote <Vote size={18}/></button><p className="fine-print">When the timer ends, the group votes for the suspected traitor.</p></section>}
    {screen==="vote" && <section className="panel-wrap"><div className="panel-heading"><div className="eyebrow">FINAL DECISION</div><h2>Who is the <em>traitor?</em></h2><p>Trust your instincts. Pick the player you think is bluffing.</p></div><div className="vote-list">{players.map((p,i)=><button key={p.id} className={`vote-player ${selectedVote===p.id?"vote-selected":""}`} onClick={()=>setSelectedVote(p.id)}><div className={`avatar av${i%6}`}>{p.name.slice(0,1).toUpperCase()}</div><span>{p.name}{p.host&&<small className="host-label">HOST</small>}</span><span className="vote-radio">{selectedVote===p.id&&<Check size={14}/>}</span></button>)}</div><button className="btn primary full" onClick={submitVote}>Lock in vote <Vote size={18}/></button><p className="fine-print">Votes are final. Choose carefully.</p></section>}
    {screen==="reveal" && <section className="reveal-screen"><div className="eyebrow"><Sparkles size={14}/> THE TRUTH COMES OUT</div><div className="reveal-orb"><Ghost size={46}/></div><h2>The traitor<br/>was <em>{players.find(p=>p.id===traitorId)?.name||"hidden"}</em>.</h2><p>{selectedVote===traitorId?"Your instincts were right. The crew caught the bluffer.":"The truth is out. Did your crew see through the bluff?"}</p><div className="result-word"><small>THE SECRET WORD WAS</small><b>{word||"TOKYO"}</b></div><button className="btn primary full" onClick={reset}>Play another round <Shuffle size={17}/></button><button className="btn text-btn full" onClick={()=>setScreen("lobby")}>Back to lobby</button></section>}
    {toast&&<div className="toast"><Zap size={15}/>{toast}<button onClick={()=>setToast("")}><X size={14}/></button></div>}
    <div className="mobile-foot">TRAITORS<span>.</span> <small>THE GAME OF TRUST & DECEPTION</small></div>
  </main>;
}