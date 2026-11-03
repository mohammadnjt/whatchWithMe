import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve application root directory reliably whether running with tsx from root or with node from dist/
const rootDir = fs.existsSync(path.join(__dirname, 'package.json'))
  ? __dirname
  : fs.existsSync(path.join(process.cwd(), 'package.json'))
  ? process.cwd()
  : path.resolve(__dirname, '..');

// Ensure upload directory exists
const uploadDir = path.join(rootDir, 'uploads');
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

import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Admin credentials from .env (with safe defaults)
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'admin123').trim();

// User record and authentication persistence
interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  salt: string;
  role: 'admin' | 'user';
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  approvedAt?: number;
  avatar: string;
  color: string;
}

interface SessionRecord {
  token: string;
  userId: string;
  username: string;
  role: 'admin' | 'user';
  expiresAt: number;
}

const dataDir = path.join(rootDir, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const usersFilePath = path.join(dataDir, 'users.json');

const users = new Map<string, UserRecord>();
const sessions = new Map<string, SessionRecord>();

function loadUsers() {
  try {
    if (fs.existsSync(usersFilePath)) {
      const data = fs.readFileSync(usersFilePath, 'utf-8');
      const list: UserRecord[] = JSON.parse(data);
      list.forEach((u) => users.set(u.id, u));
      console.log(`[Auth] Loaded ${users.size} users from storage.`);
    }
  } catch (err) {
    console.error('[Auth] Failed to load users:', err);
  }
}

function saveUsers() {
  try {
    const list = Array.from(users.values());
    fs.writeFileSync(usersFilePath, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Auth] Failed to save users:', err);
  }
}

loadUsers();

// Storage retention and uploaded files tracking
interface UploadedFileMeta {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadedAt: number;
  uploadedBy?: string;
  url: string;
}

const filesMetaPath = path.join(dataDir, 'uploaded_files.json');
const fileMetadataMap = new Map<string, UploadedFileMeta>();

// Default 0 = disabled (no automatic deletion, files stay permanently unless manually deleted by admin)
let fileRetentionHours = Number(process.env.FILE_RETENTION_HOURS) || 0;

function loadFileMetadata() {
  try {
    if (fs.existsSync(filesMetaPath)) {
      const data = fs.readFileSync(filesMetaPath, 'utf-8');
      const list: UploadedFileMeta[] = JSON.parse(data);
      list.forEach((f) => fileMetadataMap.set(f.filename, f));
    }
    // Also scan uploadDir to track any disk files
    if (fs.existsSync(uploadDir)) {
      const diskFiles = fs.readdirSync(uploadDir);
      for (const df of diskFiles) {
        const fullPath = path.join(uploadDir, df);
        if (!fs.existsSync(fullPath)) continue;
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;

        if (!fileMetadataMap.has(df)) {
          fileMetadataMap.set(df, {
            id: df,
            filename: df,
            originalName: df,
            size: stat.size,
            mimeType: 'video/mp4',
            uploadedAt: stat.mtimeMs || Date.now(),
            uploadedBy: 'سیستم',
            url: `/api/video-stream/${df}`,
          });
        }
      }
    }
  } catch (err) {
    console.error('[Storage] Error loading file metadata:', err);
  }
}

function saveFileMetadata() {
  try {
    const list = Array.from(fileMetadataMap.values());
    fs.writeFileSync(filesMetaPath, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Storage] Error saving file metadata:', err);
  }
}

loadFileMetadata();

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function cleanExpiredFiles(): { deletedCount: number; freedBytes: number } {
  if (fileRetentionHours <= 0) {
    return { deletedCount: 0, freedBytes: 0 };
  }

  const now = Date.now();
  const maxAgeMs = fileRetentionHours * 3600 * 1000;
  let deletedCount = 0;
  let freedBytes = 0;

  // Protect files currently loaded or playing in any active room
  const activeVideoUrls = new Set<string>();
  for (const r of rooms.values()) {
    if (r.movie?.videoUrl) {
      activeVideoUrls.add(r.movie.videoUrl);
      if (r.movie.qualities) {
        r.movie.qualities.forEach((q) => {
          if (q.url) activeVideoUrls.add(q.url);
        });
      }
    }
  }

  try {
    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir);
      for (const file of files) {
        const filePath = path.join(uploadDir, file);
        if (!fs.existsSync(filePath)) continue;

        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;

        const fileStreamUrl = `/api/video-stream/${file}`;
        if (activeVideoUrls.has(fileStreamUrl)) {
          // File is active in a room, skip auto-deletion
          continue;
        }

        const meta = fileMetadataMap.get(file);
        const uploadedTime = meta?.uploadedAt || stat.mtimeMs || now;
        const fileAge = now - uploadedTime;

        if (fileAge > maxAgeMs) {
          freedBytes += stat.size;
          fs.unlinkSync(filePath);
          fileMetadataMap.delete(file);
          deletedCount++;
          console.log(`[Storage Cleanup] Deleted expired file: ${file} (${formatBytes(stat.size)})`);
        }
      }
      saveFileMetadata();
    }
  } catch (err) {
    console.error('[Storage Cleanup] Error during file cleanup sweep:', err);
  }

  return { deletedCount, freedBytes };
}

// Sweep uploads every 30 minutes
setInterval(cleanExpiredFiles, 30 * 60 * 1000);

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function createSession(user: { id: string; username: string; role: 'admin' | 'user' }): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    token,
    userId: user.id,
    username: user.username,
    role: user.role,
    expiresAt: Date.now() + 30 * 24 * 3600 * 1000, // 30 days session
  });
  return token;
}

function sanitizeUser(user: UserRecord) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    avatar: user.avatar,
    color: user.color,
    createdAt: user.createdAt,
    approvedAt: user.approvedAt,
  };
}

const adminUserObj = {
  id: 'admin',
  username: ADMIN_USERNAME,
  displayName: 'مدیر سامانه (Admin)',
  role: 'admin' as const,
  status: 'approved' as const,
  avatar: 'AD',
  color: '#ec4899',
  createdAt: 0,
};

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing token' });
  }
  const token = authHeader.slice(7);
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Unauthorized: session expired or invalid' });
  }
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }
  (req as any).user = session;
  next();
}

function broadcastToAll(message: any) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// In-memory data structures
interface Participant {
  id: string;
  name: string;
  avatar: string;
  color: string;
  quality: string;
  role?: 'admin' | 'user';
  isHost?: boolean;
  online: boolean;
  ping: number;
  isMicOn?: boolean;
  isSpeaking?: boolean;
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
  movie?: MovieInfo | null;
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
      quality: '720p',
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

// ================= AUTH & ADMIN API ROUTES =================

// Unified Login / Register Endpoint (Supports both paths)
app.post(['/api/auth/login-or-register', '/api/auth/login'], (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است.' });
  }

  const cleanUsername = String(username).trim().toLowerCase();
  const cleanPassword = String(password).trim();
  const cleanDisplayName = displayName ? String(displayName).trim() : cleanUsername;

  // 1. Check if Admin logging in via .env credentials
  if (cleanUsername === ADMIN_USERNAME.toLowerCase()) {
    if (cleanPassword === ADMIN_PASSWORD || (ADMIN_PASSWORD === 'admin' && cleanPassword === 'admin123') || (ADMIN_PASSWORD === 'admin123' && cleanPassword === 'admin')) {
      const token = createSession({ id: 'admin', username: ADMIN_USERNAME, role: 'admin' });
      return res.json({
        success: true,
        token,
        user: adminUserObj,
      });
    } else {
      return res.status(401).json({
        success: false,
        error: 'رمز عبور مدیر سیستم نادرست است.',
      });
    }
  }

  // 2. Regular user: Check if exists
  const existingUser = Array.from(users.values()).find(
    (u) => u.username.toLowerCase() === cleanUsername
  );

  if (existingUser) {
    // Check password
    const hashed = hashPassword(cleanPassword, existingUser.salt);
    if (hashed !== existingUser.passwordHash) {
      return res.status(401).json({
        success: false,
        error: 'نام کاربری قبلاً ثبت شده و رمز عبور وارد شده نادرست است.',
      });
    }

    if (existingUser.status === 'pending') {
      return res.json({
        success: false,
        status: 'pending',
        userId: existingUser.id,
        username: existingUser.username,
        displayName: existingUser.displayName,
        message: 'درخواست ورود شما در انتظار تأیید مدیر سیستم است.',
      });
    }

    if (existingUser.status === 'rejected') {
      return res.json({
        success: false,
        status: 'rejected',
        userId: existingUser.id,
        username: existingUser.username,
        displayName: existingUser.displayName,
        message: 'درخواست ورود شما توسط مدیر سیستم رد شده است.',
      });
    }

    // User is approved!
    const token = createSession(existingUser);
    return res.json({
      success: true,
      token,
      user: sanitizeUser(existingUser),
    });
  }

  // 3. New user -> Auto-register in pending state (Requires admin approval)
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(cleanPassword, salt);
  const colors = ['#8b5cf6', '#3b82f6', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#6366f1'];
  const assignedColor = colors[Math.floor(Math.random() * colors.length)];
  const initials = cleanDisplayName.slice(0, 2).toUpperCase();

  const newUser: UserRecord = {
    id: `user-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
    username: cleanUsername,
    displayName: cleanDisplayName,
    passwordHash,
    salt,
    role: 'user',
    status: 'pending',
    createdAt: Date.now(),
    avatar: initials,
    color: assignedColor,
  };

  users.set(newUser.id, newUser);
  saveUsers();

  // Notify all connected admin clients in real-time
  broadcastToAll({
    type: 'admin:new_pending_user',
    user: sanitizeUser(newUser),
  });

  return res.json({
    success: false,
    status: 'pending',
    userId: newUser.id,
    username: newUser.username,
    displayName: newUser.displayName,
    message: 'حساب کاربری جدید ایجاد شد و برای ورود به تأیید مدیر سیستم ارسال گردید.',
  });
});

// Check current session
app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing session token' });
  }
  const token = authHeader.slice(7);
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Session expired' });
  }

  if (session.role === 'admin') {
    return res.json({ user: adminUserObj });
  }

  const user = users.get(session.userId);
  if (!user || user.status !== 'approved') {
    return res.status(401).json({ error: 'User not approved or revoked' });
  }

  return res.json({ user: sanitizeUser(user) });
});

// Check pending user status (used by waiting screen)
app.get('/api/auth/status', (req, res) => {
  const userId = String(req.query.userId || '');
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const user = users.get(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  let token: string | undefined;
  if (user.status === 'approved') {
    token = createSession(user);
  }

  return res.json({
    status: user.status,
    user: user.status === 'approved' ? sanitizeUser(user) : undefined,
    token,
  });
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    sessions.delete(token);
  }
  res.json({ success: true });
});

// Admin: Get all users with pending count
app.get('/api/admin/users', requireAdmin, (_req, res) => {
  const list = Array.from(users.values()).map(sanitizeUser);
  list.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (b.status === 'pending' && a.status !== 'pending') return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  const pendingCount = list.filter((u) => u.status === 'pending').length;
  res.json({ users: list, pendingCount });
});

// Admin: Approve user
app.post('/api/admin/users/:id/approve', requireAdmin, (req, res) => {
  const { id } = req.params;
  const user = users.get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.status = 'approved';
  user.approvedAt = Date.now();
  saveUsers();

  const token = createSession(user);
  const sanitized = sanitizeUser(user);

  // Broadcast real-time approval event to all clients so waiting user logs in immediately!
  broadcastToAll({
    type: 'auth:approved',
    userId: user.id,
    token,
    user: sanitized,
  });

  res.json({ success: true, user: sanitized });
});

// Admin: Reject user
app.post('/api/admin/users/:id/reject', requireAdmin, (req, res) => {
  const { id } = req.params;
  const user = users.get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.status = 'rejected';
  saveUsers();

  broadcastToAll({
    type: 'auth:rejected',
    userId: user.id,
  });

  res.json({ success: true, user: sanitizeUser(user) });
});

// Admin: Delete user
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const user = users.get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  users.delete(id);
  saveUsers();

  res.json({ success: true });
});

// ================= ADMIN VIDEO STORAGE MANAGEMENT ROUTES =================

// Admin: Get storage overview & list all uploaded video files
app.get('/api/admin/storage', requireAdmin, (_req, res) => {
  loadFileMetadata();

  const now = Date.now();
  const maxAgeMs = fileRetentionHours > 0 ? fileRetentionHours * 3600 * 1000 : null;

  // Active video URLs across all rooms
  const activeVideoUrls = new Set<string>();
  for (const r of rooms.values()) {
    if (r.movie?.videoUrl) {
      activeVideoUrls.add(r.movie.videoUrl);
      if (r.movie.qualities) {
        r.movie.qualities.forEach((q) => {
          if (q.url) activeVideoUrls.add(q.url);
        });
      }
    }
  }

  let totalBytes = 0;
  const filesList: any[] = [];

  for (const meta of fileMetadataMap.values()) {
    const filePath = path.join(uploadDir, meta.filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const stat = fs.statSync(filePath);
    const actualSize = stat.size;
    totalBytes += actualSize;

    const expiresAt = maxAgeMs ? meta.uploadedAt + maxAgeMs : null;
    const timeLeftMs = expiresAt ? Math.max(0, expiresAt - now) : null;

    let formattedTimeLeft = 'همیشگی (بدون انقضا)';
    if (timeLeftMs !== null) {
      if (timeLeftMs <= 0) {
        formattedTimeLeft = 'منقضی شده (آماده حذف)';
      } else {
        const hoursLeft = Math.floor(timeLeftMs / 3600000);
        const minsLeft = Math.floor((timeLeftMs % 3600000) / 60000);
        formattedTimeLeft = hoursLeft > 0 ? `${hoursLeft} ساعت و ${minsLeft} دقیقه` : `${minsLeft} دقیقه`;
      }
    }

    const isCurrentlyPlaying = activeVideoUrls.has(meta.url);

    filesList.push({
      id: meta.filename,
      filename: meta.filename,
      originalName: meta.originalName || meta.filename,
      size: actualSize,
      formattedSize: formatBytes(actualSize),
      mimeType: meta.mimeType || 'video/mp4',
      uploadedAt: meta.uploadedAt,
      uploadedBy: meta.uploadedBy || 'کاربر',
      expiresAt,
      timeLeftMs,
      formattedTimeLeft,
      url: meta.url,
      isCurrentlyPlaying,
    });
  }

  // Sort newest uploaded first
  filesList.sort((a, b) => b.uploadedAt - a.uploadedAt);

  res.json({
    files: filesList,
    totalBytes,
    formattedTotalSize: formatBytes(totalBytes),
    totalFiles: filesList.length,
    retentionHours: fileRetentionHours,
    maxStorageBytes: 10 * 1024 * 1024 * 1024, // 10 GB quota indicator
  });
});

// Admin: Update auto-deletion retention period
app.post('/api/admin/storage/retention', requireAdmin, (req, res) => {
  const { hours } = req.body;
  if (typeof hours !== 'number' || hours < 0) {
    return res.status(400).json({ error: 'مدت ماندگاری باید عددی مثبت یا صفر (بدون حذف) باشد.' });
  }

  fileRetentionHours = hours;
  const { deletedCount, freedBytes } = cleanExpiredFiles();

  res.json({
    success: true,
    retentionHours: fileRetentionHours,
    cleanedFiles: deletedCount,
    freedSize: formatBytes(freedBytes),
  });
});

// Admin: Manually trigger immediate cleanup of expired files
app.post('/api/admin/storage/cleanup', requireAdmin, (_req, res) => {
  const { deletedCount, freedBytes } = cleanExpiredFiles();
  res.json({
    success: true,
    deletedCount,
    freedBytes,
    formattedFreedSize: formatBytes(freedBytes),
  });
});

// Admin: Delete a specific uploaded video file immediately
app.delete('/api/admin/storage/files/:filename', requireAdmin, (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(uploadDir, filename);

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`Failed to delete file ${filePath}:`, err);
    }
  }

  fileMetadataMap.delete(filename);
  saveFileMetadata();

  res.json({ success: true, message: `فایل با موفقیت از سرور حذف شد.` });
});

// Video Upload Route
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  const fileUrl = `/api/video-stream/${req.file.filename}`;
  const meta: UploadedFileMeta = {
    id: req.file.filename,
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype,
    uploadedAt: Date.now(),
    uploadedBy: (req.body?.uploadedBy as string) || 'کاربر',
    url: fileUrl,
  };

  fileMetadataMap.set(req.file.filename, meta);
  saveFileMetadata();

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

// Helper: Fetch remote URL with redirect support and custom headers
function fetchRemoteStream(
  targetUrl: string,
  clientHeaders: http.IncomingHttpHeaders,
  redirectCount = 0
): Promise<{ res: http.IncomingMessage; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('تعداد تغییر مسیرها بیش از حد مجاز (Too many redirects) است.'));
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return reject(new Error('آدرس URL معتبر نمی‌باشد.'));
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9,fa;q=0.8',
      Referer: parsedUrl.origin + '/',
    };

    if (clientHeaders.range) {
      requestHeaders['Range'] = clientHeaders.range;
    }

    const req = client.get(
      parsedUrl,
      {
        headers: requestHeaders,
        rejectUnauthorized: false,
        timeout: 15000,
      },
      (upstreamRes) => {
        const statusCode = upstreamRes.statusCode || 200;

        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(statusCode) && upstreamRes.headers.location) {
          const nextUrl = new URL(upstreamRes.headers.location, parsedUrl).toString();
          upstreamRes.resume(); // consume response data to free memory
          return fetchRemoteStream(nextUrl, clientHeaders, redirectCount + 1)
            .then(resolve)
            .catch(reject);
        }

        resolve({ res: upstreamRes, finalUrl: targetUrl });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('مهلت زمانی اتصال به سرور مبدا به پایان رسید (Connection Timeout).'));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

// Proxy-Stream Route: Allows browser to stream external direct links with CORS & Range support
app.get('/api/proxy-stream', async (req, res) => {
  const targetUrl = req.query.url as string;

  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({ error: 'آدرس URL ویدیو مشخص نشده است.' });
  }

  try {
    const { res: upstreamRes } = await fetchRemoteStream(targetUrl, req.headers);
    const statusCode = upstreamRes.statusCode || 200;

    // Always set permissive CORS headers so browser player never fails CORS check
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Origin, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Accept-Ranges', 'bytes');

    if (statusCode >= 400) {
      let statusDesc = `خطای ${statusCode}`;
      if (statusCode === 403) statusDesc = 'دسترسی غیرمجاز (403 Forbidden / مسدود توسط سرور مبدا)';
      else if (statusCode === 404) statusDesc = 'فایل در سرور مبدا یافت نشد (404 Not Found)';
      else if (statusCode === 503) statusDesc = 'سرور مبدا موقتا در دسترس نیست (503 Service Unavailable)';

      res.status(statusCode).json({
        error: `خطا در دریافت ویدیو از سرور میزبان: ${statusDesc}`,
        statusCode,
        statusText: upstreamRes.statusMessage,
      });
      upstreamRes.resume();
      return;
    }

    // Forward streaming headers
    if (upstreamRes.headers['content-range']) {
      res.setHeader('Content-Range', upstreamRes.headers['content-range']);
    }
    if (upstreamRes.headers['content-length']) {
      res.setHeader('Content-Length', upstreamRes.headers['content-length']);
    }

    // Determine content type
    let contentType = upstreamRes.headers['content-type'] || 'video/mp4';
    if (targetUrl.endsWith('.mkv') || targetUrl.includes('.mkv?')) {
      contentType = 'video/x-matroska';
    } else if (targetUrl.endsWith('.webm')) {
      contentType = 'video/webm';
    }
    res.setHeader('Content-Type', contentType);

    res.status(statusCode);

    // Forward stream
    upstreamRes.pipe(res);

    req.on('close', () => {
      upstreamRes.destroy();
    });
  } catch (err: any) {
    console.error('[Proxy-Stream] Error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: `اتصال به سرور ویدیو ناموفق بود: ${err.message}`,
        details: err.message,
      });
    }
  }
});

// Link Diagnostic Route: Probes an external link to report real server status, CORS, and headers
app.post('/api/check-url', async (req, res) => {
  const { url: targetUrl } = req.body;

  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({ error: 'آدرس URL الزامی است.' });
  }

  try {
    const { res: upstreamRes, finalUrl } = await fetchRemoteStream(targetUrl, {
      range: 'bytes=0-1024',
    });

    const statusCode = upstreamRes.statusCode || 200;
    const contentType = upstreamRes.headers['content-type'] || 'نامشخص';
    const contentLength = Number(upstreamRes.headers['content-length']) || 0;
    const isVideo =
      contentType.includes('video') ||
      contentType.includes('octet-stream') ||
      /\.(mp4|mkv|webm|avi|mov)(\?|$)/i.test(finalUrl);

    let message = 'سرور مقصد فعال و پاسخگو است.';
    let isReachable = true;

    if (statusCode === 503) {
      message = 'سرور مبدا خطای ۵۰۳ (Service Unavailable) بازگرداند. این سرور دانلود موقتا از دسترس خارج است یا ترافیک مستقیم را مسدود کرده است.';
      isReachable = false;
    } else if (statusCode === 403) {
      message = 'سرور مبدا خطای ۴۰۳ (Forbidden) داد. دسترسی مستقیم یا خارج از دامنه مسدود است (Hotlink Protection).';
      isReachable = false;
    } else if (statusCode === 404) {
      message = 'فایل در سرور مبدا یافت نشد (خطای ۴۰۴). لینک احتمالا منقضی شده یا اشتباه است.';
      isReachable = false;
    } else if (statusCode >= 400) {
      message = `سرور مبدا کد خطای ${statusCode} بازگرداند.`;
      isReachable = false;
    } else if (!isVideo && !contentType.includes('application/')) {
      message = `سرور مبدا به جای ویدیو، فایل متنی/وب با فرمت ${contentType} بازگرداند (احتمالاً صفحه لاگین یا کپچا).`;
      isReachable = false;
    }

    upstreamRes.resume();

    res.json({
      success: isReachable,
      statusCode,
      statusMessage: upstreamRes.statusMessage || '',
      contentType,
      contentLength,
      formattedSize: contentLength > 0 ? formatBytes(contentLength) : 'نامشخص',
      finalUrl,
      isVideo,
      message,
    });
  } catch (err: any) {
    res.json({
      success: false,
      statusCode: 0,
      statusMessage: 'Connection Failed',
      contentType: 'none',
      contentLength: 0,
      formattedSize: '0 B',
      finalUrl: targetUrl,
      isVideo: false,
      message: `امکان اتصال به سرور وجود ندارد: ${err.message}`,
    });
  }
});

// Remote Download Route: Download remote video directly to server storage for lag-free room playback
app.post('/api/storage/remote-fetch', async (req, res) => {
  const { url: targetUrl, title } = req.body;

  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({ error: 'آدرس URL الزامی است.' });
  }

  try {
    const { res: upstreamRes, finalUrl } = await fetchRemoteStream(targetUrl, {});
    const statusCode = upstreamRes.statusCode || 200;

    if (statusCode >= 400) {
      upstreamRes.resume();
      return res.status(400).json({
        error: `دانلود فایل امکان‌پذیر نیست؛ سرور مبدا کد ${statusCode} داد.`,
      });
    }

    const parsed = new URL(finalUrl);
    let originalName = path.basename(parsed.pathname) || 'remote-video.mp4';
    if (!originalName.includes('.')) originalName += '.mp4';

    const ext = path.extname(originalName) || '.mp4';
    const uniqueFilename = `remote-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    const destinationPath = path.join(uploadDir, uniqueFilename);

    const fileStream = fs.createWriteStream(destinationPath);
    let downloadedBytes = 0;

    upstreamRes.on('data', (chunk) => {
      downloadedBytes += chunk.length;
    });

    upstreamRes.pipe(fileStream);

    fileStream.on('finish', () => {
      const localStreamUrl = `/api/video-stream/${uniqueFilename}`;
      const meta: UploadedFileMeta = {
        id: uniqueFilename,
        filename: uniqueFilename,
        originalName: title || originalName,
        size: downloadedBytes,
        mimeType: upstreamRes.headers['content-type'] || 'video/mp4',
        uploadedAt: Date.now(),
        uploadedBy: 'دانلود سرور',
        url: localStreamUrl,
      };

      fileMetadataMap.set(uniqueFilename, meta);
      saveFileMetadata();

      res.json({
        success: true,
        url: localStreamUrl,
        filename: uniqueFilename,
        originalName,
        size: downloadedBytes,
        formattedSize: formatBytes(downloadedBytes),
      });
    });

    fileStream.on('error', (err) => {
      console.error('[Remote-Fetch] Write error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'خطا در ذخیره‌سازی فایل روی دیسک سرور.' });
      }
    });
  } catch (err: any) {
    res.status(502).json({ error: `خطا در برقراری ارتباط برای دانلود: ${err.message}` });
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
    movie: movie && movie.videoUrl ? movie : null,
    scheduledTime: scheduledTime || null,
    status: scheduledTime ? 'scheduled' : 'playing',
    currentTime: 0,
    playbackRate: 1.0,
    isPlaying: false,
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
          // If room doesn't exist, create it dynamically without dummy video
          room = {
            id: roomId,
            name: roomId.replace(/-/g, ' ').toUpperCase(),
            movie: null,
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
          quality: user.quality || '720p',
          role: user.role || 'user',
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
        const baseMovie: MovieInfo = room.movie || {
          title: 'Custom Movie',
          year: new Date().getFullYear().toString(),
          genre: 'Cinema',
          tagline: '',
          posterUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=800&auto=format&fit=crop',
          videoUrl: '',
          duration: 0,
        };
        room.movie = { ...baseMovie, ...msg.movie };
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
          text: `Movie changed to "${room.movie?.title || 'Selected Video'}"`,
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

      // Live Voice Chat Audio Streaming
      if (msg.type === 'voice:audio') {
        broadcastToRoom(
          roomId,
          {
            type: 'voice:audio',
            senderId: clientInfo.userId,
            senderName: msg.senderName,
            chunk: msg.chunk,
            mimeType: msg.mimeType,
          },
          ws
        );
        return;
      }

      // Live Voice Mic State (mic on/off)
      if (msg.type === 'voice:mic_state') {
        const participant = room.participants.find((p) => p.id === clientInfo.userId);
        if (participant) {
          participant.isMicOn = Boolean(msg.isMicOn);
          broadcastToRoom(roomId, {
            type: 'room:participants_updated',
            participants: room.participants,
          });
        }
        return;
      }

      // Live Voice Activity / Speaking status
      if (msg.type === 'voice:speaking') {
        const participant = room.participants.find((p) => p.id === clientInfo.userId);
        if (participant) {
          participant.isSpeaking = Boolean(msg.isSpeaking);
          broadcastToRoom(roomId, {
            type: 'voice:user_speaking',
            userId: clientInfo.userId,
            isSpeaking: Boolean(msg.isSpeaking),
          });
        }
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

// Setup production static bundle serving with SPA fallback
async function startServer() {
  const distPath = path.join(rootDir, 'dist');

  // Ensure production bundle exists; if missing, build once
  if (!fs.existsSync(path.join(distPath, 'index.html'))) {
    try {
      const { execSync } = await import('child_process');
      console.log('Building frontend production bundle...');
      execSync('npx vite build', { stdio: 'inherit' });
    } catch (err) {
      console.error('Failed to pre-build frontend:', err);
    }
  }

  // Serve static assets from dist
  app.use(express.static(distPath));

  // SPA fallback for all non-API GET requests
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`WatchTogether full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
