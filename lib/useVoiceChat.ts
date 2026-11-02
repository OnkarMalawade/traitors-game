"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

interface UseVoiceChatProps {
  roomId: string;
  playerId: string;
  playerName: string;
  autoJoin?: boolean;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ]
};

export function useVoiceChat({ roomId, playerId, playerName, autoJoin = false }: UseVoiceChatProps) {
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [voicePeers, setVoicePeers] = useState<string[]>([]);
  const [speakingPlayers, setSpeakingPlayers] = useState<Record<string, boolean>>({});

  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const socketToPlayerMapRef = useRef<Map<string, string>>(new Map());
  const remoteAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const getVoiceServerUrl = () => {
    if (process.env.NEXT_PUBLIC_VOICE_SERVER_URL) {
      return process.env.NEXT_PUBLIC_VOICE_SERVER_URL;
    }
    if (typeof window !== "undefined") {
      // If deployed together or running local
      const host = window.location.hostname;
      return `http://${host}:3001`;
    }
    return "http://localhost:3001";
  };

  // Helper to start local mic stream & voice activity detection
  const setupLocalMedia = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      localStreamRef.current = stream;

      // Setup audio analyzer for voice activity detection (green pulsing circle)
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);

          audioContextRef.current = ctx;
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          let wasSpeaking = false;

          const checkSpeaking = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            const isSpeakingNow = average > 22 && !isMuted;

            if (isSpeakingNow !== wasSpeaking) {
              wasSpeaking = isSpeakingNow;
              setSpeakingPlayers(prev => ({ ...prev, [playerId]: isSpeakingNow }));
              if (socketRef.current && socketRef.current.connected) {
                socketRef.current.emit("voice-state", {
                  roomId,
                  isMuted,
                  isSpeaking: isSpeakingNow
                });
              }
            }
            animFrameRef.current = requestAnimationFrame(checkSpeaking);
          };
          animFrameRef.current = requestAnimationFrame(checkSpeaking);
        }
      } catch (e) {
        console.warn("Could not start audio analyser", e);
      }

      return stream;
    } catch (err) {
      console.warn("Microphone access denied or unavailable", err);
      return null;
    }
  };

  // Create RTCPeerConnection with a peer
  const createPeerConnection = (targetSocketId: string, targetPlayerId: string, isInitiator: boolean) => {
    if (peerConnectionsRef.current.has(targetSocketId)) {
      return peerConnectionsRef.current.get(targetSocketId)!;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionsRef.current.set(targetSocketId, pc);
    socketToPlayerMapRef.current.set(targetSocketId, targetPlayerId);

    // Add local tracks to peer connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // Handle incoming remote audio stream
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      let audio = remoteAudiosRef.current.get(targetSocketId);
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.style.display = "none";
        document.body.appendChild(audio);
        remoteAudiosRef.current.set(targetSocketId, audio);
      }
      audio.srcObject = remoteStream;
      audio.muted = isDeafened;
      audio.play().catch(e => console.warn("Remote audio play error", e));
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit("signal", {
          to: targetSocketId,
          signal: { type: "candidate", candidate: event.candidate }
        });
      }
    };

    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socketRef.current?.emit("signal", {
            to: targetSocketId,
            signal: pc.localDescription
          });
        } catch (err) {
          console.error("Error creating WebRTC offer", err);
        }
      };
    }

    return pc;
  };

  const joinVoice = useCallback(async () => {
    if (isVoiceConnected || isConnecting || !roomId || !playerId) return;
    setIsConnecting(true);

    const stream = await setupLocalMedia();
    if (!stream) {
      setIsConnecting(false);
      return;
    }

    const serverUrl = getVoiceServerUrl();
    const socket = io(serverUrl, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 5,
      timeout: 10000
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsVoiceConnected(true);
      setIsConnecting(false);
      socket.emit("join-voice", { roomId, playerId, playerName });
    });

    socket.on("connect_error", (err) => {
      console.warn("Voice server connection warning (voice server might be offline):", err.message);
      setIsConnecting(false);
    });

    // List of existing peers in the room
    socket.on("voice-peers", async (peers: Array<{ socketId: string; playerId: string; playerName: string }>) => {
      const peerIds = peers.map(p => p.playerId);
      setVoicePeers(peerIds);

      // Connect to each existing peer (we act as initiator)
      for (const peer of peers) {
        const pc = createPeerConnection(peer.socketId, peer.playerId, true);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("signal", {
            to: peer.socketId,
            signal: pc.localDescription
          });
        } catch (e) {
          console.warn("Offer error to", peer.socketId, e);
        }
      }
    });

    // A new peer joined
    socket.on("peer-joined", ({ socketId, playerId: newPlayerId }: { socketId: string; playerId: string }) => {
      setVoicePeers(prev => prev.includes(newPlayerId) ? prev : [...prev, newPlayerId]);
      createPeerConnection(socketId, newPlayerId, false);
    });

    // WebRTC signaling exchange
    socket.on("signal", async ({ from, signal }: { from: string; signal: any }) => {
      let pc = peerConnectionsRef.current.get(from);
      if (!pc) {
        const peerPlayerId = socketToPlayerMapRef.current.get(from) || "unknown";
        pc = createPeerConnection(from, peerPlayerId, false);
      }

      try {
        if (signal.type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("signal", {
            to: from,
            signal: pc.localDescription
          });
        } else if (signal.type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
        } else if (signal.type === "candidate" && signal.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
      } catch (e) {
        console.warn("WebRTC signal processing error", e);
      }
    });

    // Remote peer speaking state
    socket.on("peer-voice-state", ({ playerId: remotePlayerId, isSpeaking: remoteSpeaking }: { playerId: string; isSpeaking: boolean }) => {
      setSpeakingPlayers(prev => ({
        ...prev,
        [remotePlayerId]: remoteSpeaking
      }));
    });

    // Peer left
    socket.on("peer-left", ({ socketId, playerId: leftPlayerId }: { socketId: string; playerId: string }) => {
      const pc = peerConnectionsRef.current.get(socketId);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(socketId);
      }
      const audio = remoteAudiosRef.current.get(socketId);
      if (audio) {
        audio.remove();
        remoteAudiosRef.current.delete(socketId);
      }
      socketToPlayerMapRef.current.delete(socketId);
      setVoicePeers(prev => prev.filter(id => id !== leftPlayerId));
      setSpeakingPlayers(prev => {
        const copy = { ...prev };
        delete copy[leftPlayerId];
        return copy;
      });
    });
  }, [isVoiceConnected, isConnecting, roomId, playerId, playerName, isDeafened, isMuted]);

  const leaveVoice = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }

    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();

    remoteAudiosRef.current.forEach(a => a.remove());
    remoteAudiosRef.current.clear();
    socketToPlayerMapRef.current.clear();

    if (socketRef.current) {
      socketRef.current.emit("leave-voice", { roomId });
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setIsVoiceConnected(false);
    setIsConnecting(false);
    setVoicePeers([]);
    setSpeakingPlayers({});
  }, [roomId]);

  const toggleMute = () => {
    if (!localStreamRef.current) return;
    const newMuted = !isMuted;
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = !newMuted;
    });
    setIsMuted(newMuted);
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("voice-state", {
        roomId,
        isMuted: newMuted,
        isSpeaking: false
      });
    }
  };

  const toggleDeafen = () => {
    const newDeaf = !isDeafened;
    setIsDeafened(newDeaf);
    remoteAudiosRef.current.forEach(audio => {
      audio.muted = newDeaf;
    });
  };

  useEffect(() => {
    if (autoJoin && roomId && playerId) {
      void joinVoice();
    }
    return () => {
      leaveVoice();
    };
  }, [roomId, playerId]);

  return {
    isVoiceConnected,
    isConnecting,
    isMuted,
    isDeafened,
    voicePeers,
    speakingPlayers,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen
  };
}

