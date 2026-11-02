import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage for video uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `movie-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit for demo
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// In-memory data structures
interface Participant {
  id: string;
  name: string;
  avatar: string;
  color: string;
  quality: string;
  isHost?: boolean;
  online: boolean;
  ping: number;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  avatar: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

interface MovieInfo {
  title: string;
  year: string;
  genre: string;
  tagline: string;
  posterUrl: string;
  videoUrl: string;
  duration: number;
  qualities?: { label: string; url?: string }[];
}

interface RoomState {
  id: string;
  name: string;
  movie: MovieInfo;
  scheduledTime: string | null;
  status: 'scheduled' | 'playing' | 'paused' | 'ended';
  currentTime: number;
  playbackRate: number;
  isPlaying: boolean;
  lastUpdatedServerTime: number;
  hostId: string;
  participants: Participant[];
  chatMessages: ChatMessage[];
  allowEveryoneControl: boolean;
  syncThresholdMs: number;
}

const rooms = new Map<string, RoomState>();
const clientRooms = new Map<WebSocket, { roomId: string; userId: string }>();

// Seed default "Movie Night" room matching the design mockup!
const defaultRoom: RoomState = {
  id: 'movie-night',
  name: 'Movie Night',
  movie: {
    title: 'Interstellar',
    year: '2014',
    genre: 'Sci-Fi, Drama',
    tagline: 'Mankind was born on Earth. It was never meant to die here.',
    posterUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=800&auto=format&fit=crop',
    // High quality open-source 4K/1080p sci-fi stream (Tears of Steel / Blender Open Movie)
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    duration: 8910, // 2:28:30 matching design
    qualities: [
      { label: '4K', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4' },
      { label: '1080p', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4' },
      { label: '720p', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
      { label: '480p', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4' },
      { label: '360p', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
    ],
  },
  scheduledTime: '2026-11-02T21:24:00.000Z',
  status: 'playing',
  currentTime: 1457, // 24:17 matching design mockup
  playbackRate: 1.0,
  isPlaying: true,
  lastUpdatedServerTime: Date.now(),
  hostId: 'user-mohammad',
  participants: [
    {
      id: 'user-mohammad',
      name: 'Mohammad (You)',
      avatar: 'MN',
      color: '#8b5cf6',
      quality: '1080p',
      isHost: true,
      online: true,
      ping: 12,
    },
    {
      id: 'user-sara',
      name: 'Sara',
      avatar: 'SR',
      color: '#ec4899',
      quality: '720p',
      online: true,
      ping: 18,
    },
    {
      id: 'user-ali',
      name: 'Ali',
      avatar: 'AL',
      color: '#3b82f6',
      quality: '1080p',
      online: true,
      ping: 15,
    },
    {
      id: 'user-reza',
      name: 'Reza',
      avatar: 'RZ',
      color: '#f59e0b',
      quality: '480p',
      online: true,
      ping: 42,
    },
    {
      id: 'user-neda',
      name: 'Neda',
      avatar: 'ND',
      color: '#10b981',
      quality: '720p',
      online: true,
      ping: 24,
    },
  ],
  chatMessages: [
    {
      id: 'msg-1',
      senderId: 'user-mohammad',
      senderName: 'Mohammad',
      avatar: 'MN',
      text: 'فیلم رو استارت زدم، همه هماهنگ هستید؟',
      timestamp: Date.now() - 360000,
    },
    {
      id: 'msg-2',
      senderId: 'user-sara',
      senderName: 'Sara',
      avatar: 'SR',
      text: 'آره صدای هانس زیمر فوق‌العاده‌ست! کاملاً سینک هستم.',
      timestamp: Date.now() - 280000,
    },
    {
      id: 'msg-3',
      senderId: 'user-ali',
      senderName: 'Ali',
      avatar: 'AL',
      text: 'کیفیت ۱۰۸۰ بدون افت فریم روونه 🚀',
      timestamp: Date.now() - 140000,
    },
  ],
  allowEveryoneControl: true,
  syncThresholdMs: 250,
};

rooms.set('movie-night', defaultRoom);

// Video Upload Route
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  const fileUrl = `/api/video-stream/${req.file.filename}`;
  res.json({
    url: fileUrl,
    filename: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype,
  });
});

// Range-capable video streaming route for ultra-fast seek
app.get('/api/video-stream/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// API: List rooms
app.get('/api/rooms', (_req, res) => {
  const list = Array.from(rooms.values()).map((r) => ({
    id: r.id,
    name: r.name,
    movie: r.movie,
    status: r.status,
    scheduledTime: r.scheduledTime,
    participantCount: r.participants.filter((p) => p.online).length,
  }));
  res.json(list);
});

// API: Create or update room
app.post('/api/rooms', (req, res) => {
  const { id, name, movie, scheduledTime } = req.body;
  const roomId = id || `room-${Date.now().toString(36)}`;

  const newRoom: RoomState = {
    id: roomId,
    name: name || 'New Watch Party',
    movie: movie || {
      title: 'Cinematic Feature',
      year: '2026',
      genre: 'Cinema',
      tagline: 'Experience cinema together in real time.',
      posterUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=800&auto=format&fit=crop',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
      duration: 7200,
      qualities: [
        { label: '1080p', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4' },
        { label: '720p', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
      ],
    },
    scheduledTime: scheduledTime || null,
    status: scheduledTime ? 'scheduled' : 'playing',
    currentTime: 0,
    playbackRate: 1.0,
    isPlaying: !scheduledTime,
    lastUpdatedServerTime: Date.now(),
    hostId: req.body.hostId || 'host',
    participants: [],
    chatMessages: [],
    allowEveryoneControl: true,
    syncThresholdMs: 250,
  };

  rooms.set(roomId, newRoom);
  res.json(newRoom);
});

// Broadcast helper
function broadcastToRoom(roomId: string, message: any, excludeWs?: WebSocket) {
  const payload = JSON.stringify(message);
  for (const [ws, info] of clientRooms.entries()) {
    if (info.roomId === roomId && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

// WebSocket Connection Management
wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Ultra-low latency NTP Ping/Pong
      if (msg.type === 'ping') {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'pong',
              clientTimestamp: msg.clientTimestamp,
              serverTimestamp: Date.now(),
            })
          );
        }
        return;
      }

      if (msg.type === 'join') {
        const { roomId, user } = msg;
        let room = rooms.get(roomId);
        if (!room) {
          // If room doesn't exist, create it dynamically
          room = {
            id: roomId,
            name: roomId.replace(/-/g, ' ').toUpperCase(),
            movie: defaultRoom.movie,
            scheduledTime: null,
            status: 'playing',
            currentTime: 0,
            playbackRate: 1.0,
            isPlaying: false,
            lastUpdatedServerTime: Date.now(),
            hostId: user.id,
            participants: [],
            chatMessages: [],
            allowEveryoneControl: true,
            syncThresholdMs: 250,
          };
          rooms.set(roomId, room);
        }

        // Register client mapping
        clientRooms.set(ws, { roomId, userId: user.id });

        // Update participant in room
        const existingIdx = room.participants.findIndex((p) => p.id === user.id);
        const participantObj: Participant = {
          id: user.id,
          name: user.name,
          avatar: user.avatar || user.name.slice(0, 2).toUpperCase(),
          color: user.color || '#8b5cf6',
          quality: user.quality || '1080p',
          isHost: room.hostId === user.id || room.participants.length === 0,
          online: true,
          ping: 12,
        };

        if (existingIdx >= 0) {
          room.participants[existingIdx] = { ...room.participants[existingIdx], ...participantObj, online: true };
        } else {
          room.participants.push(participantObj);
        }

        // Calculate authoritative current time accounting for elapsed playback
        const now = Date.now();
        let currentCalculatedTime = room.currentTime;
        if (room.isPlaying) {
          const elapsedSeconds = (now - room.lastUpdatedServerTime) / 1000;
          currentCalculatedTime += elapsedSeconds * room.playbackRate;
        }

        // Send room initialization
        ws.send(
          JSON.stringify({
            type: 'room:init',
            room: {
              ...room,
              currentTime: currentCalculatedTime,
            },
            serverTime: now,
            yourId: user.id,
          })
        );

        // Notify others
        broadcastToRoom(roomId, {
          type: 'room:participants_updated',
          participants: room.participants,
        });

        broadcastToRoom(
          roomId,
          {
            type: 'room:notification',
            text: `${user.name} joined the room`,
            variant: 'info',
          },
          ws
        );
        return;
      }

      const clientInfo = clientRooms.get(ws);
      if (!clientInfo) return;
      const { roomId } = clientInfo;
      const room = rooms.get(roomId);
      if (!room) return;

      // Video playback actions (Play / Pause / Seek / Rate)
      if (msg.type === 'video:action') {
        const { action, currentTime, playbackRate, actionBy } = msg;

        // Apply authoritative update
        room.currentTime = typeof currentTime === 'number' ? currentTime : room.currentTime;
        if (typeof playbackRate === 'number') {
          room.playbackRate = playbackRate;
        }
        if (action === 'play') {
          room.isPlaying = true;
          room.status = 'playing';
        } else if (action === 'pause') {
          room.isPlaying = false;
          room.status = 'paused';
        }
        room.lastUpdatedServerTime = Date.now();

        // Broadcast synchronized state to ALL clients in the room (including sender confirmation)
        broadcastToRoom(roomId, {
          type: 'video:sync',
          currentTime: room.currentTime,
          isPlaying: room.isPlaying,
          playbackRate: room.playbackRate,
          lastUpdatedServerTime: room.lastUpdatedServerTime,
          actionBy,
          actionType: action,
        });
        return;
      }

      // Quality changes by a user
      if (msg.type === 'user:quality') {
        const participant = room.participants.find((p) => p.id === clientInfo.userId);
        if (participant) {
          participant.quality = msg.quality;
          broadcastToRoom(roomId, {
            type: 'room:participants_updated',
            participants: room.participants,
          });
        }
        return;
      }

      // Chat messages
      if (msg.type === 'chat:message') {
        const chatMsg: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          senderId: msg.sender.id,
          senderName: msg.sender.name,
          avatar: msg.sender.avatar || msg.sender.name.slice(0, 2).toUpperCase(),
          text: msg.text,
          timestamp: Date.now(),
        };
        room.chatMessages.push(chatMsg);
        if (room.chatMessages.length > 200) room.chatMessages.shift();

        broadcastToRoom(roomId, {
          type: 'chat:new_message',
          message: chatMsg,
        });
        return;
      }

      // Movie updates (changing video URL, title, poster, upload)
      if (msg.type === 'room:update_movie') {
        room.movie = { ...room.movie, ...msg.movie };
        room.currentTime = 0;
        room.isPlaying = false;
        room.lastUpdatedServerTime = Date.now();

        broadcastToRoom(roomId, {
          type: 'room:movie_updated',
          movie: room.movie,
          scheduledTime: room.scheduledTime,
          status: room.status,
        });

        broadcastToRoom(roomId, {
          type: 'room:notification',
          text: `Movie changed to "${room.movie.title}"`,
          variant: 'info',
        });
        return;
      }

      // Schedule updates
      if (msg.type === 'room:update_schedule') {
        room.scheduledTime = msg.scheduledTime;
        if (msg.status) {
          room.status = msg.status;
          if (msg.status === 'playing') {
            room.isPlaying = true;
            room.lastUpdatedServerTime = Date.now();
          }
        }
        broadcastToRoom(roomId, {
          type: 'room:movie_updated',
          movie: room.movie,
          scheduledTime: room.scheduledTime,
          status: room.status,
        });
        return;
      }
    } catch (err) {
      console.error('Error processing WS message:', err);
    }
  });

  ws.on('close', () => {
    const clientInfo = clientRooms.get(ws);
    if (clientInfo) {
      const { roomId, userId } = clientInfo;
      const room = rooms.get(roomId);
      if (room) {
        const participant = room.participants.find((p) => p.id === userId);
        if (participant) {
          participant.online = false;
          broadcastToRoom(roomId, {
            type: 'room:participants_updated',
            participants: room.participants,
          });
        }
      }
      clientRooms.delete(ws);
    }
  });
});

// Setup Vite in development or static in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`WatchTogether full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
