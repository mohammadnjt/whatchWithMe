export interface MovieQuality {
  label: string; // e.g. "4K", "1080p", "720p", "480p", "360p", "Auto"
  url?: string;
}

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

export interface Participant {
  id: string;
  name: string;
  avatar: string;
  color: string;
  quality: string;
  isHost?: boolean;
  online: boolean;
  ping: number;
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
