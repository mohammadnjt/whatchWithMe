import React, { useState } from 'react';
import { X, DoorOpen, Plus, Users, ArrowRight, Copy, Check } from 'lucide-react';

interface RoomsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRoomId: string;
  onSelectRoom: (roomId: string) => void;
  showToast: (text: string, variant?: string) => void;
}

export const RoomsModal: React.FC<RoomsModalProps> = ({
  isOpen,
  onClose,
  currentRoomId,
  onSelectRoom,
  showToast,
}) => {
  const [newRoomName, setNewRoomName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  if (!isOpen) return null;

  const sampleRooms = [
    { id: 'movie-night', name: 'Movie Night', movie: 'Interstellar', online: 5 },
    { id: 'sci-fi-galaxy', name: 'Sci-Fi Club', movie: 'Tears of Steel 4K', online: 3 },
    { id: 'anime-lounge', name: 'Anime & Shorts', movie: 'Big Buck Bunny', online: 2 },
  ];

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    const slug = newRoomName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    onSelectRoom(slug);
    showToast(`Created & switched to room: ${newRoomName}`, 'success');
    onClose();
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    const clean = joinCode.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
    onSelectRoom(clean);
    showToast(`Switched to room: ${clean}`, 'success');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#101426] border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
              <DoorOpen className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-base sm:text-lg text-white">Watch Rooms</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {/* Active Rooms */}
          <div>
            <label className="block text-slate-300 font-semibold mb-2">Available Rooms</label>
            <div className="space-y-2">
              {sampleRooms.map((r) => {
                const isActive = r.id === currentRoomId;
                return (
                  <div
                    key={r.id}
                    onClick={() => {
                      if (!isActive) {
                        onSelectRoom(r.id);
                        onClose();
                      }
                    }}
                    className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      isActive
                        ? 'bg-purple-600/20 border-purple-500/50 text-white'
                        : 'bg-[#0c1020] border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-sm text-white flex items-center gap-2">
                        <span>{r.name}</span>
                        {isActive && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/30 text-purple-300">
                            Current
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">Now showing: {r.movie}</div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                      <Users className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{r.online} online</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Create Room */}
          <form onSubmit={handleCreateRoom} className="pt-2 border-t border-slate-800/80">
            <label className="block text-slate-300 font-semibold mb-1.5">
              Create New Room
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. Cinema Weekend"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                className="flex-1 bg-[#0c1020] border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 text-xs"
              />
              <button
                type="submit"
                disabled={!newRoomName.trim()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold rounded-xl shadow transition-all flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create</span>
              </button>
            </div>
          </form>

          {/* Join by code */}
          <form onSubmit={handleJoinByCode} className="pt-2 border-t border-slate-800/80">
            <label className="block text-slate-300 font-semibold mb-1.5">
              Join by Room Code / URL Slug
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. movie-night"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="flex-1 bg-[#0c1020] border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 text-xs font-mono"
              />
              <button
                type="submit"
                disabled={!joinCode.trim()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl transition-all flex items-center gap-1"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>Join</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
