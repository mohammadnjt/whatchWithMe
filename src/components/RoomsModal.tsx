import React, { useEffect, useState } from 'react';
import { X, Plus, Users, ArrowLeft } from 'lucide-react';
import { cleanRoomCode, createRoom } from './HomeScreen';

interface RoomsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRoomId: string;
  onSelectRoom: (roomId: string) => void;
  showToast: (text: string, variant?: string) => void;
}

interface RoomInfo {
  id: string;
  name: string;
  movie?: { title?: string } | null;
  participantCount?: number;
}

export const RoomsModal: React.FC<RoomsModalProps> = ({ isOpen, onClose, currentRoomId, onSelectRoom }) => {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [newRoomName, setNewRoomName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/rooms')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => Array.isArray(data) && setRooms(data))
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const go = (id: string) => {
    if (id && id !== currentRoomId) onSelectRoom(id);
    onClose();
  };

  const inputClass =
    'flex-1 bg-[#0c1020] border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 text-xs';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" dir="rtl" onClick={onClose}>
      <div className="bg-[#101426] border border-slate-700/80 rounded-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="font-bold text-white">اتاق‌ها</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {rooms.length === 0 && <p className="text-slate-500 text-center py-2">اتاقی وجود ندارد.</p>}
            {rooms.map((r) => (
              <button
                key={r.id}
                onClick={() => go(r.id)}
                className={`w-full p-3 rounded-xl border flex items-center justify-between text-right ${
                  r.id === currentRoomId
                    ? 'bg-purple-600/20 border-purple-500/50'
                    : 'bg-[#0c1020] border-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-bold text-sm text-white truncate">{r.name || r.id}</div>
                  {r.movie?.title && <div className="text-[11px] text-slate-400 truncate">{r.movie.title}</div>}
                </div>
                <span className="flex items-center gap-1 text-slate-400 shrink-0">
                  <Users className="w-3.5 h-3.5 text-emerald-400" />
                  {r.participantCount || 0}
                </span>
              </button>
            ))}
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (newRoomName.trim()) go(await createRoom(newRoomName));
            }}
            className="flex gap-2 pt-3 border-t border-slate-800"
          >
            <input value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="نام اتاق جدید" className={inputClass} />
            <button
              type="submit"
              disabled={!newRoomName.trim()}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold rounded-xl flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              ساخت
            </button>
          </form>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              go(cleanRoomCode(joinCode));
            }}
            className="flex gap-2"
          >
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="کد اتاق" dir="ltr" className={`${inputClass} text-right font-mono`} />
            <button
              type="submit"
              disabled={!cleanRoomCode(joinCode)}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-bold rounded-xl flex items-center gap-1"
            >
              ورود
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
