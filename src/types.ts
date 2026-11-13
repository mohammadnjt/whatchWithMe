export interface MovieQuality {
  label: string; // one of QUALITY_LABELS
  url?: string;
}

/**
 * Renditions a movie can carry a separate link for, best first.
 *
 * There is no transcoding behind this: each entry is simply another file, so a
 * quality can only be offered when a link for it has been entered. The label
 * shown when a viewer is on the movie's own default link is DEFAULT_QUALITY.
 */
export const QUALITY_LABELS = ['4K', '1080p', '720p', '480p', '360p'] as const;

export const DEFAULT_QUALITY = 'پیش‌فرض';

export interface MovieInfo {
  title: string;
  year: string;
  genre: string;
  tagline: string;
  posterUrl: string;
  videoUrl: string;
  duration: number; // in seconds
  qualities?: MovieQuality[];
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  status: 'pending' | 'approved' | 'rejected';
  avatar: string;
  color: string;
  createdAt?: number;
  approvedAt?: number;
}

/** A film stored on the server (data/films.json). */
export interface StorageFileItem {
  id: string;
  filename: string;
  title: string;
  size: number;
  formattedSize: string;
  uploadedAt: number;
  uploadedBy?: string;
  lastWatchedAt: number | null;
  expiresAt: number | null;
  timeLeftMs: number | null;
  formattedTimeLeft: string;
  url: string;
  isCurrentlyPlaying: boolean;
}

export interface StorageStats {
  films: StorageFileItem[];
  totalBytes: number;
  formattedTotalSize: string;
  totalFiles: number;
  retentionHours: number;
  maxStorageBytes: number;
}

export interface Participant {
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

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  avatar: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface RoomState {
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

export type WebSocketClientMessage =
  | { type: 'join'; roomId: string; user: { id: string; name: string; avatar: string; quality: string } }
  | { type: 'ping'; clientTimestamp: number }
  | { type: 'video:action'; action: 'play' | 'pause' | 'seek' | 'rate'; currentTime: number; playbackRate?: number; actionBy: string }
  | { type: 'chat:message'; text: string; sender: { id: string; name: string; avatar: string } }
  | { type: 'user:quality'; quality: string }
  | { type: 'room:update_movie'; movie: Partial<MovieInfo> }
  | { type: 'room:update_schedule'; scheduledTime: string | null; status?: 'scheduled' | 'playing' }
  | { type: 'room:settings'; allowEveryoneControl?: boolean; syncThresholdMs?: number };

export type WebSocketServerMessage =
  | { type: 'room:init'; room: RoomState; serverTime: number; yourId: string }
  | { type: 'pong'; clientTimestamp: number; serverTimestamp: number }
  | { type: 'video:sync'; currentTime: number; isPlaying: boolean; playbackRate: number; lastUpdatedServerTime: number; actionBy?: string; actionType?: string }
  | { type: 'chat:new_message'; message: ChatMessage }
  | { type: 'room:participants_updated'; participants: Participant[] }
  | { type: 'room:movie_updated'; movie: MovieInfo; scheduledTime: string | null; status: RoomState['status'] }
  | { type: 'room:notification'; text: string; variant?: 'info' | 'success' | 'warning' };
