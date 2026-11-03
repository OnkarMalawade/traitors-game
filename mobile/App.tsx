import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Alert,
  ActivityIndicator,
  Share,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { ensureMobileAnonymousSession, getMobileSupabase } from './supabase';
import { io, Socket } from 'socket.io-client';
import {
  Ghost,
  Users,
  Timer,
  Eye,
  Shield,
  ShieldCheck,
  Skull,
  Vote,
  Trophy,
  AlertTriangle,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  MessageCircle,
  Send,
  Radio,
  Check,
  Crown,
  Copy,
  ArrowRight,
  Shuffle,
  X
} from 'lucide-react-native';

type Screen = 'home' | 'setup' | 'join' | 'lobby' | 'role' | 'game' | 'vote' | 'vote_result' | 'shield' | 'kill' | 'reveal';
type Player = { id: string; name: string; host?: boolean; alive?: boolean };
type ChatMessage = { id: string; playerId: string; name: string; text: string; sentAt: string };

const CATEGORIES = ['Places', 'Brands', 'Anime', 'Football', 'Cricket', 'Games', 'Countries', 'Animals', 'Movies', 'Comics'];

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [name, setName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [duration, setDuration] = useState(8);
  const [category, setCategory] = useState('Places');
  const [gameMode, setGameMode] = useState<'basic' | 'advanced'>('basic');
  const [roomCode, setRoomCode] = useState('');
  const [roomId, setRoomId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [word, setWord] = useState('');
  const [isTraitor, setIsTraitor] = useState(false);
  const [showWord, setShowWord] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [round, setRound] = useState(1);
  const [winner, setWinner] = useState<'traitor' | 'innocents' | null>(null);
  const [lastVotedOutId, setLastVotedOutId] = useState('');
  const [lastKilledId, setLastKilledId] = useState('');
  const [traitorId, setTraitorId] = useState('');
  const [votesCast, setVotesCast] = useState(0);
  const [hasVoted, setHasVoted] = useState(false);
  const [selectedVote, setSelectedVote] = useState('');
  const [shieldVotesCast, setShieldVotesCast] = useState(0);
  const [hasShieldVoted, setHasShieldVoted] = useState(false);
  const [selectedShield, setSelectedShield] = useState('');
  const [selectedKill, setSelectedKill] = useState('');

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [chatTab, setChatTab] = useState<'chat' | 'tips'>('chat');

  // Voice Chat
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [isVoiceConnecting, setIsVoiceConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [voicePeers, setVoicePeers] = useState<string[]>([]);
  const [speakingPlayers, setSpeakingPlayers] = useState<Record<string, boolean>>({});
  const voiceSocketRef = useRef<Socket | null>(null);

  const prevRoundRef = useRef(1);
  const alivePlayers = useMemo(() => players.filter(p => p.alive !== false), [players]);

  // Game countdown timer
  useEffect(() => {
    if (!['game', 'shield', 'kill'].includes(screen) || seconds <= 0) return;
    const t = setInterval(() => setSeconds(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [screen, seconds]);

  useEffect(() => {
    if (screen === 'game' && seconds === 0) setScreen('vote');
  }, [screen, seconds]);

  // Voice Socket setup
  const joinVoiceChat = () => {
    if (isVoiceConnected || isVoiceConnecting || !roomId || !playerId) return;
    setIsVoiceConnecting(true);

    const voiceServerUrl = process.env.EXPO_PUBLIC_VOICE_SERVER_URL || 'http://10.0.2.2:3001';
    const socket = io(voiceServerUrl, {
      transports: ['websocket'],
      timeout: 8000
    });
    voiceSocketRef.current = socket;

    socket.on('connect', () => {
      setIsVoiceConnected(true);
      setIsVoiceConnecting(false);
      socket.emit('join-voice', { roomId, playerId, playerName: name });
    });

    socket.on('connect_error', () => {
      setIsVoiceConnecting(false);
      Alert.alert('Voice Server', 'Voice server is offline or unreachable. Text chat is still active.');
    });

    socket.on('voice-peers', (peers: any[]) => {
      setVoicePeers(peers.map(p => p.playerId));
    });

    socket.on('peer-joined', (p: any) => {
      setVoicePeers(prev => (prev.includes(p.playerId) ? prev : [...prev, p.playerId]));
    });

    socket.on('peer-voice-state', ({ playerId: pId, isSpeaking }: any) => {
      setSpeakingPlayers(prev => ({ ...prev, [pId]: isSpeaking }));
    });

    socket.on('peer-left', ({ playerId: pId }: any) => {
      setVoicePeers(prev => prev.filter(id => id !== pId));
    });
  };

  const leaveVoiceChat = () => {
    if (voiceSocketRef.current) {
      voiceSocketRef.current.emit('leave-voice', { roomId });
      voiceSocketRef.current.disconnect();
      voiceSocketRef.current = null;
    }
    setIsVoiceConnected(false);
    setIsVoiceConnecting(false);
    setVoicePeers([]);
    setSpeakingPlayers({});
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (voiceSocketRef.current) {
      voiceSocketRef.current.emit('voice-state', { roomId, isMuted: next, isSpeaking: false });
    }
  };

  const toggleDeafen = () => {
    setIsDeafened(!isDeafened);
  };

  // Supabase Room refresh
  const refreshRoom = async (rId: string) => {
    try {
      const supabase = getMobileSupabase();
      const { data, error } = await supabase.rpc('traitor_room_state', { p_room_id: rId });
      if (error) throw error;
      const r = data as any;
      const roster = (r.players || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        host: p.host,
        alive: p.alive !== false
      }));
      setPlayers(roster);
      setRoomCode(r.code);
      setMaxPlayers(r.max_players);
      setDuration(r.duration_minutes);
      setCategory(r.category);
      setGameMode(r.game_mode || 'basic');

      const newRound = r.round_number || 1;
      if (newRound > prevRoundRef.current) {
        prevRoundRef.current = newRound;
        setRound(newRound);
        setSelectedVote('');
        setSelectedShield('');
        setSelectedKill('');
        setHasVoted(false);
        setHasShieldVoted(false);
        if (r.status === 'playing') setScreen('role');
      } else {
        setRound(newRound);
      }

      setVotesCast(r.votes_cast || 0);
      setShieldVotesCast(r.shield_votes_cast || 0);
      setHasVoted(!!r.has_voted);
      setHasShieldVoted(!!r.has_shield_voted);
      setLastKilledId(r.last_killed_player_id || '');
      setLastVotedOutId(r.last_voted_out_player_id || '');
      if (r.winner) setWinner(r.winner);

      if (r.status === 'lobby') { setScreen('lobby'); return; }
      if (r.status === 'revealed') {
        const { data: res } = await supabase.rpc('traitor_reveal', { p_room_id: rId });
        if (res) {
          setWord((res as any).word || '');
          setTraitorId((res as any).traitor_player_id || '');
          setWinner((res as any).winner || null);
          setScreen('reveal');
        }
        return;
      }

      const { data: role } = await supabase.rpc('traitor_my_role', { p_room_id: rId });
      if (role) {
        setIsTraitor(!!(role as any).is_traitor);
        setWord((role as any).word || '');
        if ((role as any).traitor_player_id) setTraitorId((role as any).traitor_player_id);
      }

      if (r.status === 'playing') {
        const endTime = r.phase_ends_at;
        const rem = endTime ? Math.max(0, Math.floor((new Date(endTime).getTime() - Date.now()) / 1000)) : duration * 60;
        setSeconds(rem);
        setScreen(curr => (curr === 'lobby' ? 'role' : curr));
      } else if (r.status === 'voting') {
        setScreen('vote');
      } else if (r.status === 'vote_result') {
        setScreen('vote_result');
      } else if (r.status === 'shield') {
        setScreen('shield');
      } else if (r.status === 'kill') {
        setScreen('kill');
      }
    } catch (e: any) {
      console.warn('Refresh error', e);
    }
  };

  // Realtime subscription
  useEffect(() => {
    if (!roomId) return;
    const supabase = getMobileSupabase();
    const ch = supabase.channel(`mobile-room-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'traitor_rooms', filter: `id=eq.${roomId}` }, () => {
        void refreshRoom(roomId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'traitor_players', filter: `room_id=eq.${roomId}` }, () => {
        void refreshRoom(roomId);
      })
      .subscribe();

    const interval = setInterval(() => void refreshRoom(roomId), 3000);
    return () => {
      clearInterval(interval);
      void supabase.removeChannel(ch);
    };
  }, [roomId]);

  // Chat subscription
  useEffect(() => {
    if (!roomId || !playerId) return;
    const supabase = getMobileSupabase();
    const ch = supabase.channel(`mobile-chat-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'traitor_chat_messages', filter: `room_id=eq.${roomId}` }, async () => {
        const { data } = await supabase.rpc('traitor_chat_history', { p_room_id: roomId });
        if (Array.isArray(data)) setChatMessages((data as any[]).map(m => ({
          id: String(m.id),
          playerId: String(m.player_id),
          name: String(m.name || 'Player'),
          text: String(m.text || ''),
          sentAt: String(m.sent_at || new Date().toISOString())
        })));
      })
      .subscribe();

    void (async () => {
      const { data } = await supabase.rpc('traitor_chat_history', { p_room_id: roomId });
      if (Array.isArray(data)) setChatMessages((data as any[]).map(m => ({
        id: String(m.id),
        playerId: String(m.player_id),
        name: String(m.name || 'Player'),
        text: String(m.text || ''),
        sentAt: String(m.sent_at || new Date().toISOString())
      })));
    })();

    return () => { void supabase.removeChannel(ch); };
  }, [roomId, playerId]);

  const createRoom = async () => {
    if (!name.trim()) { Alert.alert('Required', 'Please enter your name'); return; }
    try {
      const supabase = getMobileSupabase();
      await ensureMobileAnonymousSession();
      const { data, error } = await supabase.rpc('traitor_create_room', {
        p_name: name.trim(),
        p_max_players: maxPlayers,
        p_duration: duration,
        p_category: category,
        p_game_mode: gameMode
      });
      if (error) throw error;
      const r = data as any;
      setRoomId(r.room_id);
      setRoomCode(r.code);
      setPlayerId(r.player_id);
      setIsHost(true);
      setPlayers((r.players || []).map((p: any) => ({ id: p.id, name: p.name, host: p.host, alive: true })));
      setScreen('lobby');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not create room');
    }
  };

  const joinRoom = async (code: string) => {
    if (!name.trim()) { Alert.alert('Required', 'Enter your name first'); return; }
    if (!code.trim()) { Alert.alert('Required', 'Enter a 6-letter room code'); return; }
    try {
      const supabase = getMobileSupabase();
      await ensureMobileAnonymousSession();
      const { data, error } = await supabase.rpc('traitor_join_room', {
        p_code: code.trim().toUpperCase(),
        p_name: name.trim()
      });
      if (error) throw error;
      const r = data as any;
      setRoomId(r.room_id);
      setRoomCode(r.code);
      setPlayerId(r.player_id);
      setIsHost(false);
      setScreen('lobby');
      await refreshRoom(r.room_id);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not join room');
    }
  };

  const startGame = async () => {
    if (players.length < 3) {
      Alert.alert('Players Needed', 'You need at least 3 players to start!');
      return;
    }
    try {
      const { error } = await getMobileSupabase().rpc('traitor_start_game', { p_room_id: roomId });
      if (error) throw error;
      await refreshRoom(roomId);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not start game');
    }
  };

  const sendChatMessage = async () => {
    if (!chatDraft.trim()) return;
    const text = chatDraft.trim();
    setChatDraft('');
    try {
      const { error } = await getMobileSupabase().rpc('traitor_send_chat_message', { p_room_id: roomId, p_text: text });
      if (error) throw error;
    } catch (e: any) {
      Alert.alert('Chat Error', e?.message || 'Could not send message');
    }
  };

  const submitVote = async () => {
    if (!selectedVote) { Alert.alert('Select Target', 'Pick who you suspect is bluffing'); return; }
    try {
      const { data, error } = await getMobileSupabase().rpc('traitor_cast_vote', {
        p_room_id: roomId,
        p_target_player_id: selectedVote
      });
      if (error) throw error;
      setHasVoted(true);
      await refreshRoom(roomId);
    } catch (e: any) {
      Alert.alert('Vote Error', e?.message || 'Could not submit vote');
    }
  };

  const submitShield = async () => {
    if (!selectedShield) { Alert.alert('Select Ally', 'Pick an innocent player to rescue'); return; }
    try {
      const { data, error } = await getMobileSupabase().rpc('traitor_cast_shield', {
        p_room_id: roomId,
        p_target_player_id: selectedShield
      });
      if (error) throw error;
      setHasShieldVoted(true);
      await refreshRoom(roomId);
    } catch (e: any) {
      Alert.alert('Shield Error', e?.message || 'Could not submit shield');
    }
  };

  const submitKill = async () => {
    if (!selectedKill) { Alert.alert('Select Target', 'Pick an innocent player to eliminate'); return; }
    try {
      const { data, error } = await getMobileSupabase().rpc('traitor_kill_player', {
        p_room_id: roomId,
        p_target_player_id: selectedKill
      });
      if (error) throw error;
      await refreshRoom(roomId);
    } catch (e: any) {
      Alert.alert('Kill Error', e?.message || 'Could not execute kill');
    }
  };

  const advancePhase = async () => {
    try {
      const { error } = await getMobileSupabase().rpc('traitor_advance_phase', { p_room_id: roomId });
      if (error) throw error;
      await refreshRoom(roomId);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not advance phase');
    }
  };

  const resetGame = () => {
    leaveVoiceChat();
    setScreen('home');
    setRoomId('');
    setRoomCode('');
    setPlayerId('');
    setPlayers([]);
    setWord('');
    setIsTraitor(false);
    setSelectedVote('');
    setSelectedShield('');
    setSelectedKill('');
    setHasVoted(false);
    setHasShieldVoted(false);
    setRound(1);
  };

  const lastVotedName = players.find(p => p.id === lastVotedOutId)?.name || 'An Innocent';
  const traitorName = players.find(p => p.id === traitorId)?.name || 'The Traitor';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.brand}>
          <Ghost size={20} color="#d8fb68" />
          <Text style={styles.brandTitle}>TRAITORS <Text style={{ color: '#d8fb68' }}>.</Text></Text>
        </View>
        <View style={styles.headerRight}>
          {gameMode === 'advanced' && (
            <View style={styles.roundBadge}>
              <Text style={styles.roundBadgeText}>ADVANCED · R{round}</Text>
            </View>
          )}
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* 1. HOME SCREEN */}
          {screen === 'home' && (
            <View style={styles.card}>
              <Text style={styles.eyebrow}>BLUFFING PARTY GAME</Text>
              <Text style={styles.heroTitle}>One Word.{"\n"}One <Text style={{ color: '#d8fb68' }}>Traitor.</Text>{"\n"}Trust No One.</Text>
              <Text style={styles.heroSub}>Everyone knows the secret word except one player. Ask clues, vote out the bluffer, or rescue allies with shields!</Text>

              <TextInput
                style={styles.input}
                placeholder="Enter your name"
                placeholderTextColor="#777"
                value={name}
                onChangeText={setName}
              />

              <TouchableOpacity style={styles.btnPrimary} onPress={() => setScreen('setup')}>
                <Text style={styles.btnPrimaryText}>Create New Room</Text>
                <ArrowRight size={18} color="#15160e" />
              </TouchableOpacity>

              <TouchableOpacity style={styles.btnSecondary} onPress={() => setScreen('join')}>
                <Text style={styles.btnSecondaryText}>Join Existing Room</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 2. SETUP SCREEN */}
          {screen === 'setup' && (
            <View style={styles.card}>
              <Text style={styles.eyebrow}>ROOM CONFIGURATION</Text>
              <Text style={styles.sectionTitle}>Set up your game</Text>

              <Text style={styles.label}>GAME MODE</Text>
              <View style={styles.modeToggle}>
                <TouchableOpacity
                  style={[styles.modeBtn, gameMode === 'basic' && styles.modeBtnActive]}
                  onPress={() => setGameMode('basic')}
                >
                  <Text style={[styles.modeBtnTitle, gameMode === 'basic' && { color: '#d8fb68' }]}>Classic Mode</Text>
                  <Text style={styles.modeBtnDesc}>1 Round · Quick vote & reveal</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modeBtn, gameMode === 'advanced' && styles.modeBtnActive]}
                  onPress={() => setGameMode('advanced')}
                >
                  <Text style={[styles.modeBtnTitle, gameMode === 'advanced' && { color: '#d8fb68' }]}>Advanced Mode</Text>
                  <Text style={styles.modeBtnDesc}>Multi-round · Shields & Night Kills</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>CATEGORY</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                {CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catChip, category === cat && styles.catChipActive]}
                    onPress={() => setCategory(cat)}
                  >
                    <Text style={[styles.catChipText, category === cat && { color: '#15160e', fontWeight: 'bold' }]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity style={styles.btnPrimary} onPress={createRoom}>
                <Text style={styles.btnPrimaryText}>Create Lobby</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 3. JOIN SCREEN */}
          {screen === 'join' && (
            <View style={styles.card}>
              <Text style={styles.eyebrow}>ENTER GAME CODE</Text>
              <Text style={styles.sectionTitle}>Join a Room</Text>

              <TextInput
                style={styles.input}
                placeholder="Your Name"
                placeholderTextColor="#777"
                value={name}
                onChangeText={setName}
              />
              <TextInput
                style={[styles.input, styles.codeInput]}
                placeholder="6-LETTER CODE"
                placeholderTextColor="#777"
                autoCapitalize="characters"
                maxLength={6}
                value={roomCode}
                onChangeText={setRoomCode}
              />

              <TouchableOpacity style={styles.btnPrimary} onPress={() => joinRoom(roomCode)}>
                <Text style={styles.btnPrimaryText}>Enter Lobby</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 4. LOBBY SCREEN */}
          {screen === 'lobby' && (
            <View style={styles.card}>
              <View style={styles.lobbyTop}>
                <Text style={styles.eyebrow}>ROOM CODE</Text>
                <Text style={styles.codeDisplay}>{roomCode}</Text>
                <TouchableOpacity
                  style={styles.shareBtn}
                  onPress={() => Share.share({ message: `Join my Traitors game room! Code: ${roomCode}` })}
                >
                  <Copy size={14} color="#d8fb68" />
                  <Text style={styles.shareBtnText}>Share Code with Friends</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>PLAYERS ({players.length}/3 MIN)</Text>
              {players.map(p => (
                <View key={p.id} style={styles.playerRow}>
                  <View style={[styles.avatar, speakingPlayers[p.id] && styles.avatarSpeaking]}>
                    <Text style={styles.avatarText}>{p.name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <Text style={styles.playerName}>{p.name}</Text>
                  {p.host && <Crown size={16} color="#d8fb68" />}
                </View>
              ))}

              {isHost ? (
                <TouchableOpacity
                  style={[styles.btnPrimary, players.length < 3 && { opacity: 0.5 }]}
                  disabled={players.length < 3}
                  onPress={startGame}
                >
                  <Text style={styles.btnPrimaryText}>Start Game ({players.length}/3)</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.waitText}>Waiting for host to start...</Text>
              )}
            </View>
          )}

          {/* 5. ROLE SCREEN */}
          {screen === 'role' && (
            <View style={styles.card}>
              <Text style={styles.eyebrow}>ROUND {round} / YOUR SECRET CARD</Text>
              <Text style={styles.sectionTitle}>Look at your role</Text>
              <Text style={styles.heroSub}>Keep your screen hidden from other players.</Text>

              <TouchableOpacity
                style={[styles.roleCard, showWord && styles.roleCardRevealed]}
                onPress={() => setShowWord(!showWord)}
              >
                {showWord ? (
                  <>
                    <Text style={styles.roleCardSymbol}>{isTraitor ? '♟' : '✦'}</Text>
                    <Text style={styles.roleCardRole}>{isTraitor ? 'YOU ARE THE TRAITOR' : word}</Text>
                    <Text style={styles.roleCardDesc}>
                      {isTraitor ? 'Act like you know the word. Blend in!' : 'Keep this word secret from the traitor.'}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.roleCardSymbol}>?</Text>
                    <Text style={styles.roleCardPrompt}>TAP TO REVEAL</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.btnPrimary} onPress={() => setScreen('game')}>
                <Text style={styles.btnPrimaryText}>I&apos;m Ready to Discuss</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 6. DISCUSSION & CHAT SCREEN */}
          {screen === 'game' && (
            <View style={styles.card}>
              <View style={styles.gameTopBar}>
                <Text style={styles.eyebrow}>ROUND {round} DISCUSSION</Text>
                <View style={styles.timerBadge}>
                  <Timer size={14} color="#d8fb68" />
                  <Text style={styles.timerText}>
                    {Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, '0')}
                  </Text>
                </View>
              </View>

              {/* Voice Chat Module Status */}
              <View style={styles.voiceModuleBox}>
                <View style={styles.voiceStatusLeft}>
                  <Radio size={18} color="#d8fb68" />
                  <View>
                    <Text style={styles.voiceStatusTitle}>
                      {isVoiceConnected ? `Voice Live (${voicePeers.length + 1} speaking)` : 'Voice Chat Available'}
                    </Text>
                    <Text style={styles.voiceStatusSub}>
                      {isVoiceConnected ? (isMuted ? 'Microphone Muted' : 'Microphone Open') : 'Talk to your crew in real-time'}
                    </Text>
                  </View>
                </View>
                {!isVoiceConnected ? (
                  <TouchableOpacity style={styles.voiceJoinBtn} onPress={joinVoiceChat} disabled={isVoiceConnecting}>
                    <Text style={styles.voiceJoinBtnText}>{isVoiceConnecting ? '...' : 'Join'}</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity style={[styles.voiceBtn, isMuted && styles.voiceBtnMuted]} onPress={toggleMute}>
                      {isMuted ? <MicOff size={16} color="#ff657a" /> : <Mic size={16} color="#d8fb68" />}
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.voiceBtn, isDeafened && styles.voiceBtnMuted]} onPress={toggleDeafen}>
                      {isDeafened ? <VolumeX size={16} color="#ff657a" /> : <Volume2 size={16} color="#d8fb68" />}
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Chat Tabs */}
              <View style={styles.tabRow}>
                <TouchableOpacity
                  style={[styles.tabBtn, chatTab === 'chat' && styles.tabBtnActive]}
                  onPress={() => setChatTab('chat')}
                >
                  <Text style={[styles.tabBtnText, chatTab === 'chat' && { color: '#d8fb68' }]}>Room Chat</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tabBtn, chatTab === 'tips' && styles.tabBtnActive]}
                  onPress={() => setChatTab('tips')}
                >
                  <Text style={[styles.tabBtnText, chatTab === 'tips' && { color: '#d8fb68' }]}>Tips & Clues</Text>
                </TouchableOpacity>
              </View>

              {chatTab === 'chat' ? (
                <View style={styles.chatBox}>
                  <ScrollView style={styles.chatScroll} nestedScrollEnabled>
                    {chatMessages.length === 0 ? (
                      <Text style={styles.chatEmpty}>No messages yet. Send a subtle clue!</Text>
                    ) : (
                      chatMessages.map(m => (
                        <View key={m.id} style={[styles.chatBubble, m.playerId === playerId && styles.chatBubbleMine]}>
                          <Text style={styles.chatAuthor}>{m.name}</Text>
                          <Text style={styles.chatMsg}>{m.text}</Text>
                        </View>
                      ))
                    )}
                  </ScrollView>
                  <View style={styles.chatInputRow}>
                    <TextInput
                      style={styles.chatInput}
                      placeholder="Type a clue..."
                      placeholderTextColor="#777"
                      value={chatDraft}
                      onChangeText={setChatDraft}
                    />
                    <TouchableOpacity style={styles.chatSendBtn} onPress={sendChatMessage}>
                      <Send size={16} color="#15160e" />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.tipsBox}>
                  <Text style={styles.tipTitle}>01. Ask smart questions</Text>
                  <Text style={styles.tipDesc}>What does it feel like? Where would you see it?</Text>
                  <Text style={styles.tipTitle}>02. Watch for hesitation</Text>
                  <Text style={styles.tipDesc}>The traitor has no idea what the secret word is.</Text>
                </View>
              )}

              <TouchableOpacity style={styles.btnPrimary} onPress={() => setScreen('vote')}>
                <Text style={styles.btnPrimaryText}>Proceed to Vote</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 7. VOTE SCREEN */}
          {screen === 'vote' && (
            <View style={styles.card}>
              <Text style={styles.eyebrow}>ROUND {round} / ELIMINATION VOTE</Text>
              <Text style={styles.sectionTitle}>Who is the Traitor?</Text>
              <Text style={styles.heroSub}>A decisive majority is required to unmask the Traitor. You cannot vote for yourself.</Text>

              <Text style={styles.label}>PROGRESS: {votesCast} / {alivePlayers.length} VOTED</Text>

              {hasVoted ? (
                <View style={styles.noticeBox}>
                  <Check size={20} color="#d8fb68" />
                  <Text style={styles.noticeText}>Vote locked in! Waiting for others...</Text>
                </View>
              ) : (
                <>
                  {alivePlayers.filter(p => p.id !== playerId).map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.voteItem, selectedVote === p.id && styles.voteItemActive]}
                      onPress={() => setSelectedVote(p.id)}
                    >
                      <Text style={[styles.voteItemText, selectedVote === p.id && { color: '#d8fb68', fontWeight: 'bold' }]}>
                        {p.name}
                      </Text>
                      {selectedVote === p.id && <Check size={18} color="#d8fb68" />}
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={styles.btnPrimary} onPress={submitVote}>
                    <Text style={styles.btnPrimaryText}>Lock In Vote</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* 8. VOTE RESULT SCREEN */}
          {screen === 'vote_result' && (
            <View style={styles.card}>
              <Text style={styles.eyebrow}>ROUND {round} / VOTE RESOLVED</Text>
              <Text style={styles.sectionTitle}>The Verdict</Text>

              {lastVotedOutId ? (
                <View style={[styles.noticeBox, { borderColor: '#ff657a' }]}>
                  <Skull size={24} color="#ff657a" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.noticeTitle, { color: '#ff657a' }]}>{lastVotedName} was voted out!</Text>
                    <Text style={styles.noticeSub}>They were an Innocent. The Traitor survived!</Text>
                  </View>
                </View>
              ) : (
                <View style={[styles.noticeBox, { borderColor: '#ffd166' }]}>
                  <AlertTriangle size={24} color="#ffd166" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.noticeTitle, { color: '#ffd166' }]}>Stalemate — Votes Tied!</Text>
                    <Text style={styles.noticeSub}>No decisive majority was reached. Nobody was eliminated.</Text>
                  </View>
                </View>
              )}

              <TouchableOpacity style={styles.btnPrimary} onPress={advancePhase}>
                <Text style={styles.btnPrimaryText}>Continue to Next Phase</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 9. SHIELD RESCUE SCREEN */}
          {screen === 'shield' && (
            <View style={styles.card}>
              <Text style={styles.eyebrow}>RESCUE SHIELD PHASE</Text>
              <Text style={styles.sectionTitle}>Protect an Ally</Text>
              <Text style={styles.heroSub}>Innocents vote to give one player immunity from tonight&apos;s Traitor kill.</Text>

              {isTraitor ? (
                <View style={styles.noticeBox}>
                  <Skull size={20} color="#ff657a" />
                  <Text style={styles.noticeText}>You are the Traitor. Waiting for innocents to vote...</Text>
                </View>
              ) : hasShieldVoted ? (
                <View style={styles.noticeBox}>
                  <ShieldCheck size={20} color="#64b5f6" />
                  <Text style={styles.noticeText}>Shield vote locked in!</Text>
                </View>
              ) : (
                <>
                  {alivePlayers.filter(p => p.id !== playerId).map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.voteItem, selectedShield === p.id && styles.voteItemActive]}
                      onPress={() => setSelectedShield(p.id)}
                    >
                      <Text style={styles.voteItemText}>{p.name}</Text>
                      {selectedShield === p.id && <Check size={18} color="#d8fb68" />}
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={styles.btnPrimary} onPress={submitShield}>
                    <Text style={styles.btnPrimaryText}>Grant Shield</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* 10. TRAITOR KILL SCREEN */}
          {screen === 'kill' && (
            <View style={styles.card}>
              <Text style={styles.eyebrow}>NIGHTFALL / TRAITOR STRIKE</Text>
              <Text style={styles.sectionTitle}>The Shadows Move</Text>

              {isTraitor ? (
                <>
                  <Text style={styles.heroSub}>Choose an innocent player to eliminate.</Text>
                  {alivePlayers.filter(p => p.id !== playerId).map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.voteItem, selectedKill === p.id && styles.voteItemActive]}
                      onPress={() => setSelectedKill(p.id)}
                    >
                      <Text style={styles.voteItemText}>{p.name}</Text>
                      {selectedKill === p.id && <Skull size={18} color="#ff657a" />}
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={[styles.btnPrimary, { backgroundColor: '#ff657a' }]} onPress={submitKill}>
                    <Text style={[styles.btnPrimaryText, { color: '#fff' }]}>Execute Night Strike</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.noticeBox}>
                  <Ghost size={28} color="#d8fb68" />
                  <Text style={styles.noticeText}>The Traitor is striking in the shadows. If shielded, you survive!</Text>
                </View>
              )}
            </View>
          )}

          {/* 11. REVEAL / GAME OVER SCREEN */}
          {screen === 'reveal' && (
            <View style={styles.card}>
              <View style={styles.winnerOrb}>
                {winner === 'innocents' ? <Trophy size={48} color="#d8fb68" /> : <Skull size={48} color="#ff657a" />}
              </View>
              <Text style={styles.heroTitle}>{winner === 'innocents' ? 'Innocents Win!' : 'Traitor Wins!'}</Text>
              <Text style={styles.heroSub}>
                {winner === 'innocents'
                  ? `The crew successfully unmasked ${traitorName}!`
                  : `${traitorName} deceived everyone and survived!`}
              </Text>

              <View style={styles.revealInfo}>
                <Text style={styles.revealLabel}>ACTUAL TRAITOR</Text>
                <Text style={styles.revealVal}>{traitorName}</Text>
                <Text style={[styles.revealLabel, { marginTop: 12 }]}>SECRET WORD</Text>
                <Text style={styles.revealVal}>{word || 'HIDDEN'}</Text>
              </View>

              <TouchableOpacity style={styles.btnPrimary} onPress={resetGame}>
                <Text style={styles.btnPrimaryText}>Play Another Game</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e0d12' },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: '#24212e'
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandTitle: { fontSize: 18, fontWeight: '700', color: '#f6f3fa', letterSpacing: 1.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  roundBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#201e29', borderWidth: 1, borderColor: '#302d3b' },
  roundBadgeText: { fontSize: 10, color: '#d8fb68', fontWeight: '600' },
  scroll: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: '#17161e', borderRadius: 16, borderWidth: 1, borderColor: '#302d3b', padding: 20, marginBottom: 16 },
  eyebrow: { fontSize: 10, letterSpacing: 1.5, color: '#d8fb68', fontWeight: '700', marginBottom: 8 },
  heroTitle: { fontSize: 32, fontWeight: '800', color: '#f6f3fa', lineHeight: 38, marginBottom: 12 },
  heroSub: { fontSize: 13, color: '#9c98a9', lineHeight: 20, marginBottom: 18 },
  sectionTitle: { fontSize: 24, fontWeight: '700', color: '#f6f3fa', marginBottom: 12 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: '#9c98a9', marginTop: 14, marginBottom: 8 },
  input: {
    backgroundColor: '#100f15',
    borderWidth: 1,
    borderColor: '#3a3546',
    borderRadius: 10,
    color: '#f6f3fa',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 14
  },
  codeInput: { textAlign: 'center', fontSize: 18, letterSpacing: 4, fontWeight: '700' },
  btnPrimary: {
    backgroundColor: '#d8fb68',
    paddingVertical: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10
  },
  btnPrimaryText: { color: '#15160e', fontSize: 14, fontWeight: '700' },
  btnSecondary: {
    backgroundColor: '#201e28',
    borderWidth: 1,
    borderColor: '#393544',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10
  },
  btnSecondaryText: { color: '#f4f1fa', fontSize: 14, fontWeight: '600' },
  modeToggle: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  modeBtn: { flex: 1, padding: 12, backgroundColor: '#100f15', borderWidth: 1, borderColor: '#332f3d', borderRadius: 10 },
  modeBtnActive: { borderColor: '#d8fb68', backgroundColor: '#d8fb6810' },
  modeBtnTitle: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 4 },
  modeBtnDesc: { fontSize: 10, color: '#777' },
  catChip: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#100f15', borderWidth: 1, borderColor: '#332f3d', borderRadius: 20, marginRight: 8 },
  catChipActive: { backgroundColor: '#d8fb68', borderColor: '#d8fb68' },
  catChipText: { fontSize: 12, color: '#9c98a9' },
  lobbyTop: { alignItems: 'center', marginVertical: 12 },
  codeDisplay: { fontSize: 36, fontWeight: '800', color: '#d8fb68', letterSpacing: 6, marginVertical: 6 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  shareBtnText: { color: '#d8fb68', fontSize: 12, fontWeight: '600' },
  playerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#24212e' },
  avatar: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#2e283b', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarSpeaking: { borderWidth: 2, borderColor: '#d8fb68' },
  avatarText: { color: '#d8fb68', fontWeight: 'bold' },
  playerName: { flex: 1, color: '#fff', fontSize: 14 },
  waitText: { textAlign: 'center', color: '#777', fontSize: 12, marginTop: 14 },
  roleCard: { height: 260, backgroundColor: '#1f1c29', borderWidth: 1, borderColor: '#3e374d', borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginVertical: 16, padding: 20 },
  roleCardRevealed: { borderColor: '#d8fb68', backgroundColor: '#262232' },
  roleCardSymbol: { fontSize: 64, color: '#d8fb68', marginBottom: 8 },
  roleCardPrompt: { fontSize: 16, fontWeight: 'bold', color: '#d8fb68' },
  roleCardRole: { fontSize: 20, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 8 },
  roleCardDesc: { fontSize: 12, color: '#9c98a9', textAlign: 'center' },
  gameTopBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  timerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#201e29', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  timerText: { color: '#d8fb68', fontWeight: '700', fontSize: 13 },
  voiceModuleBox: { backgroundColor: '#121117', borderWidth: 1, borderColor: '#2b2738', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  voiceStatusLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  voiceStatusTitle: { color: '#fff', fontSize: 12, fontWeight: '700' },
  voiceStatusSub: { color: '#777', fontSize: 10 },
  voiceJoinBtn: { backgroundColor: '#d8fb68', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14 },
  voiceJoinBtnText: { color: '#15160e', fontSize: 12, fontWeight: 'bold' },
  voiceBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#201e29', alignItems: 'center', justifyContent: 'center' },
  voiceBtnMuted: { backgroundColor: '#3b1c24' },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#292535', marginBottom: 10 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderColor: '#d8fb68' },
  tabBtnText: { color: '#777', fontSize: 13, fontWeight: '600' },
  chatBox: { height: 260 },
  chatScroll: { flex: 1, paddingVertical: 6 },
  chatEmpty: { textAlign: 'center', color: '#777', marginTop: 40, fontSize: 12 },
  chatBubble: { backgroundColor: '#201e29', borderRadius: 8, padding: 8, marginBottom: 8, maxWidth: '85%' },
  chatBubbleMine: { alignSelf: 'flex-end', backgroundColor: '#2c3619' },
  chatAuthor: { fontSize: 10, color: '#d8fb68', fontWeight: 'bold', marginBottom: 2 },
  chatMsg: { fontSize: 12, color: '#f6f3fa' },
  chatInputRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  chatInput: { flex: 1, backgroundColor: '#100f15', borderWidth: 1, borderColor: '#332f3d', borderRadius: 8, color: '#fff', paddingHorizontal: 10, paddingVertical: 8, fontSize: 12 },
  chatSendBtn: { backgroundColor: '#d8fb68', width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tipsBox: { padding: 12 },
  tipTitle: { color: '#d8fb68', fontSize: 13, fontWeight: 'bold', marginTop: 8 },
  tipDesc: { color: '#9c98a9', fontSize: 12, marginTop: 2 },
  voteItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, backgroundColor: '#100f15', borderWidth: 1, borderColor: '#2e2a3b', borderRadius: 10, marginBottom: 8 },
  voteItemActive: { borderColor: '#d8fb68', backgroundColor: '#d8fb6810' },
  voteItemText: { color: '#fff', fontSize: 14 },
  noticeBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: '#1c1826', borderWidth: 1, borderColor: '#3d344f', borderRadius: 10, marginVertical: 12 },
  noticeTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 2 },
  noticeSub: { fontSize: 11, color: '#9c98a9' },
  noticeText: { color: '#fff', fontSize: 12, flex: 1 },
  winnerOrb: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#221e2e', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginVertical: 16 },
  revealInfo: { backgroundColor: '#100f15', borderWidth: 1, borderColor: '#2a2636', borderRadius: 10, padding: 14, marginVertical: 16 },
  revealLabel: { fontSize: 10, color: '#777', fontWeight: 'bold', letterSpacing: 1 },
  revealVal: { fontSize: 18, color: '#d8fb68', fontWeight: '800', marginTop: 2 }
});

