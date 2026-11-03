import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, DoorOpen, Film, Users, LogOut, Play, ShieldCheck } from 'lucide-react';
import { AuthUser } from '../types';

interface HomeScreenProps {
  currentUser: AuthUser;
  onJoinRoom: (roomId: string) => void;
  onLogout: () => void;
  onOpenAdminUsers?: () => void;
  pendingUsersCount?: number;
  showToast: (text: string, variant?: string) => void;
}

interface RoomInfo {
  id: string;
  name: string;
  movie?: { title?: string } | null;
  participantCount?: number;
}

/** Turns a room name into a URL-safe id; names without latin letters get a generated id. */
export function roomSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `room-${Date.now().toString(36)}`;
}

export function cleanRoomCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
}

export async function createRoom(name: string): Promise<string> {
  const id = roomSlug(name);
  await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name: name.trim() || 'اتاق جدید' }),
  }).catch(() => {});
  return id;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  currentUser,
  onJoinRoom,
  onLogout,
  onOpenAdminUsers,
  pendingUsersCount = 0,
  showToast,
}) => {
  const [roomCode, setRoomCode] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [rooms, setRooms] = useState<RoomInfo[]>([]);

  useEffect(() => {
    fetch('/api/rooms')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => Array.isArray(data) && setRooms(data))
      .catch(() => {});
  }, []);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const code = cleanRoomCode(roomCode);
    if (!code) {
      showToast('کد اتاق معتبر نیست.', 'warning');
      return;
    }
    onJoinRoom(code);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    onJoinRoom(await createRoom(newRoomName));
  };

  return (
    <div dir="rtl" className="relative min-h-screen w-full bg-[#060813] text-slate-100 flex flex-col overflow-x-hidden">
      <div
        className="fixed inset-0 pointer-events-none bg-cover bg-center"
        style={{
          backgroundImage: `url('/assets/bg-home.avif'), url('/assets/bg-home.webp'), url('/assets/bg-home.jpg')`,
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-l from-[#060813] via-[#060813]/95 via-45% to-[#060813]/40" />
      </div>

      <header className="relative z-20 w-full px-6 sm:px-10 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5" dir="ltr">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center">
            <Play className="w-4 h-4 text-white fill-white ml-0.5" />
          </div>
          <span className="font-extrabold text-xl">
            Watch<span className="text-purple-400">Together</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {currentUser.role === 'admin' && onOpenAdminUsers && (
            <button
              onClick={onOpenAdminUsers}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-950/60 border border-purple-500/40 text-purple-200 text-xs font-semibold hover:bg-purple-900/70"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>مدیریت</span>
              {pendingUsersCount > 0 && (
                <span className="px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">{pendingUsersCount}</span>
              )}
            </button>
          )}
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
            style={{ backgroundColor: currentUser.color || '#8b5cf6' }}
            title={currentUser.displayName}
          >
            {currentUser.avatar || currentUser.displayName.slice(0, 1)}
          </div>
          <button onClick={onLogout} className="p-2 rounded-full text-slate-400 hover:text-rose-400" title="خروج">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="relative z-10 w-full max-w-6xl mx-auto px-6 sm:px-10 py-8 flex-1 flex flex-col justify-center">
        <div className="max-w-md w-full flex flex-col gap-5">
          <h1 className="text-4xl sm:text-5xl font-extrabold" dir="ltr" style={{ textAlign: 'right' }}>
            Watch <span className="bg-gradient-to-r from-purple-400 to-indigo-300 bg-clip-text text-transparent">Together</span>
          </h1>

          <form onSubmit={handleJoin} className="flex items-center gap-2 bg-[#13162b]/90 border border-purple-500/30 focus-within:border-purple-400 rounded-2xl p-2">
            <DoorOpen className="w-5 h-5 text-purple-300 shrink-0 mx-2" />
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              placeholder="کد اتاق"
              dir="ltr"
              className="w-full bg-transparent px-2 py-2 text-white placeholder-slate-400 focus:outline-none text-right"
            />
            <button
              type="submit"
              className="w-10 h-10 rounded-xl bg-purple-600 hover:bg-purple-500 flex items-center justify-center shrink-0"
              title="ورود به اتاق"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          </form>

          <form onSubmit={handleCreate} className="flex items-center gap-2">
            <input
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="نام اتاق جدید"
              className="flex-1 bg-[#13162b]/90 border border-slate-700 focus:border-purple-400 rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newRoomName.trim()}
              className="px-4 py-3 rounded-2xl border border-purple-500/40 bg-purple-950/30 hover:bg-purple-900/50 text-purple-200 text-sm font-medium flex items-center gap-1.5 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              ساخت اتاق
            </button>
          </form>

          {rooms.length > 0 && (
            <div className="flex flex-col gap-2 pt-2">
              <span className="text-xs font-semibold text-slate-400">اتاق‌ها</span>
              {rooms.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onJoinRoom(r.id)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#101426]/80 hover:bg-[#161a33] border border-purple-500/20 hover:border-purple-500/40 flex items-center justify-between gap-3 text-right"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Film className="w-4 h-4 text-purple-300 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{r.name || r.id}</div>
                      {r.movie?.title && <div className="text-[11px] text-slate-400 truncate">{r.movie.title}</div>}
                    </div>
                  </div>
                  {(r.participantCount || 0) > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400 shrink-0">
                      <Users className="w-3.5 h-3.5" />
                      {r.participantCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
