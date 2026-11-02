import React, { useState } from 'react';
import { Play, Copy, Check, Plus, Film, Calendar, Globe, MonitorPlay, Compass, DoorOpen } from 'lucide-react';

interface NavbarProps {
  roomName: string;
  roomId: string;
  userName: string;
  userAvatar: string;
  onOpenRooms: () => void;
  onOpenChangeMovie: () => void;
  onOpenSchedule: () => void;
  onEditProfile: () => void;
  showToast: (text: string, variant?: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  roomName,
  roomId,
  userName,
  userAvatar,
  onOpenRooms,
  onOpenChangeMovie,
  onOpenSchedule,
  onEditProfile,
  showToast,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    const url = `${window.location.origin}/?room=${encodeURIComponent(roomId)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      showToast('Room invite link copied to clipboard! Share with friends.', 'success');
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      showToast(`Room ID: ${roomId}`, 'info');
    });
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-[#0a0d18]/90 backdrop-blur-md border-b border-purple-900/20 px-4 sm:px-6 lg:px-8 py-3 transition-all">
      <div className="max-w-[1720px] mx-auto flex items-center justify-between gap-4">
        {/* Left: Brand & Navigation */}
        <div className="flex items-center gap-6 sm:gap-8">
          <div className="flex items-center gap-2.5 cursor-pointer group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-purple-600/30 group-hover:scale-105 transition-transform">
              <Play className="w-5 h-5 text-white fill-white ml-0.5" />
            </div>
            <span className="font-extrabold text-lg sm:text-xl tracking-tight bg-gradient-to-r from-white via-slate-100 to-purple-200 bg-clip-text text-transparent">
              Watch<span className="text-purple-400">Together</span>
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-1 sm:gap-2">
            <button
              onClick={onOpenRooms}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
            >
              <DoorOpen className="w-4 h-4 text-purple-400" />
              <span>Rooms</span>
            </button>
            <button
              onClick={onOpenChangeMovie}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
            >
              <Film className="w-4 h-4 text-purple-400" />
              <span>Change Video</span>
            </button>
            <button
              onClick={onOpenSchedule}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
            >
              <Calendar className="w-4 h-4 text-purple-400" />
              <span>Schedule</span>
            </button>
          </nav>
        </div>

        {/* Right: Room status pill & profile */}
        <div className="flex items-center gap-2.5 sm:gap-3.5">
          {/* Quick Add Video / Change button */}
          <button
            onClick={onOpenChangeMovie}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/15 hover:bg-purple-600/25 border border-purple-500/30 text-purple-300 text-xs font-medium transition-all"
            title="Upload or load video URL"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Load Movie</span>
          </button>

          {/* Room Pill */}
          <div className="flex items-center gap-2 bg-[#121629]/90 border border-slate-800/80 rounded-full px-3.5 py-1.5 shadow-sm text-xs sm:text-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" />
            <span className="text-slate-200 truncate max-w-[110px] sm:max-w-[180px]">
              Room: <strong className="font-semibold text-white">{roomName}</strong>
            </span>
            <button
              onClick={handleCopyLink}
              title="Copy room invite link"
              className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors ml-0.5"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* User Profile Avatar */}
          <button
            onClick={onEditProfile}
            title={`Logged in as ${userName} (click to edit)`}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-indigo-700 to-purple-800 border border-purple-400/40 flex items-center justify-center font-bold text-xs sm:text-sm text-purple-100 shadow-md hover:ring-2 hover:ring-purple-400/50 transition-all cursor-pointer"
          >
            {userAvatar || userName.slice(0, 2).toUpperCase()}
          </button>
        </div>
      </div>
    </header>
  );
};
