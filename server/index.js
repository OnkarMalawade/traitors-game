const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000,
  pingTimeout: 5000
});

// In-memory tracking of voice rooms:
// roomId -> Map(socketId -> { playerId, playerName, isMuted, isSpeaking })
const voiceRooms = new Map();
const socketToRoom = new Map();

app.get('/', (req, res) => {
  res.send('Traitors Voice & Signaling Server is running.');
});

app.get('/health', (req, res) => {
  const activeRooms = voiceRooms.size;
  let totalPeers = 0;
  for (const peers of voiceRooms.values()) {
    totalPeers += peers.size;
  }
  res.json({
    status: 'ok',
    activeRooms,
    totalPeers,
    timestamp: new Date().toISOString()
  });
});

io.on('connection', (socket) => {
  // Join a room's voice channel
  socket.on('join-voice', ({ roomId, playerId, playerName }) => {
    if (!roomId || !playerId) return;

    socket.join(`voice:${roomId}`);
    socketToRoom.set(socket.id, { roomId, playerId });

    if (!voiceRooms.has(roomId)) {
      voiceRooms.set(roomId, new Map());
    }

    const roomPeers = voiceRooms.get(roomId);
    
    // Existing peers in this voice room
    const existingPeers = [];
    for (const [peerSocketId, peerData] of roomPeers.entries()) {
      existingPeers.push({
        socketId: peerSocketId,
        playerId: peerData.playerId,
        playerName: peerData.playerName,
        isMuted: peerData.isMuted,
        isSpeaking: peerData.isSpeaking
      });
    }

    // Register this new peer
    roomPeers.set(socket.id, {
      playerId,
      playerName: playerName || 'Player',
      isMuted: false,
      isSpeaking: false
    });

    // Send existing peers list to newly connected peer
    socket.emit('voice-peers', existingPeers);

    // Notify all existing peers in the room that a new peer joined
    socket.to(`voice:${roomId}`).emit('peer-joined', {
      socketId: socket.id,
      playerId,
      playerName: playerName || 'Player'
    });
  });

  // WebRTC Signaling: offer, answer, ice-candidate
  socket.on('signal', ({ to, signal }) => {
    if (!to || !signal) return;
    io.to(to).emit('signal', {
      from: socket.id,
      signal
    });
  });

  // Voice state: mute/unmute and speaking detection
  socket.on('voice-state', ({ roomId, isMuted, isSpeaking }) => {
    if (!roomId || !voiceRooms.has(roomId)) return;
    const roomPeers = voiceRooms.get(roomId);
    const peer = roomPeers.get(socket.id);
    if (!peer) return;

    peer.isMuted = isMuted !== undefined ? isMuted : peer.isMuted;
    peer.isSpeaking = isSpeaking !== undefined ? isSpeaking : peer.isSpeaking;

    socket.to(`voice:${roomId}`).emit('peer-voice-state', {
      socketId: socket.id,
      playerId: peer.playerId,
      isMuted: peer.isMuted,
      isSpeaking: peer.isSpeaking
    });
  });

  // Explicit leave
  socket.on('leave-voice', ({ roomId }) => {
    handlePeerLeave(socket, roomId);
  });

  // Disconnection cleanup
  socket.on('disconnect', () => {
    const info = socketToRoom.get(socket.id);
    if (info) {
      handlePeerLeave(socket, info.roomId);
    }
  });
});

function handlePeerLeave(socket, roomId) {
  socketToRoom.delete(socket.id);
  if (!roomId || !voiceRooms.has(roomId)) return;

  const roomPeers = voiceRooms.get(roomId);
  const peer = roomPeers.get(socket.id);
  if (peer) {
    roomPeers.delete(socket.id);
    socket.to(`voice:${roomId}`).emit('peer-left', {
      socketId: socket.id,
      playerId: peer.playerId
    });
  }

  if (roomPeers.size === 0) {
    voiceRooms.delete(roomId);
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[Traitors Voice Server] listening on port ${PORT}`);
});

