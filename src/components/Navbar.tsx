import React, { useState } from 'react';
import { Play, Copy, Check, Film, Calendar, DoorOpen, ShieldCheck, LogOut } from 'lucide-react';

interface NavbarProps {
  roomName: string;
  roomId: string;
  userName: string;
  userAvatar: string;
  userColor?: string;
  userRole?: 'admin' | 'user';
  pendingUsersCount?: number;
  onOpenRooms: () => void;
  onOpenChangeMovie: () => void;
  onOpenSchedule: () => void;
  onOpenAdminUsers?: () => void;
  onEditProfile: () => void;
  onLogout?: () => void;
  onLeaveRoom?: () => void;
  showToast: (text: string, variant?: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  roomName,
  roomId,
  userName,
  userAvatar,
  userColor,
  userRole,
  pendingUsersCount = 0,
  onOpenRooms,
  onOpenChangeMovie,
  onOpenSchedule,
  onOpenAdminUsers,
  onEditProfile,
  onLogout,
  onLeaveRoom,
  showToast,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    const url = `${window.location.origin}/?room=${encodeURIComponent(roomId)}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        showToast('لینک اتاق کپی شد.', 'success');
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => showToast(url, 'info'));
  };

  const navBtn = 'flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800/60';

  return (
    <header className="sticky top-0 z-40 w-full bg-[#0a0d18]/90 backdrop-blur-md border-b border-purple-900/20 px-3 sm:px-6 lg:px-8 py-3" dir="rtl">
      <div className="max-w-[1720px] mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-5 min-w-0">
          <button onClick={onLeaveRoom} className="flex items-center gap-2 shrink-0" title="بازگشت به خانه" dir="ltr">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center">
              <Play className="w-5 h-5 text-white fill-white ml-0.5" />
            </div>
            <span className="hidden sm:inline font-extrabold text-lg">
              Watch<span className="text-purple-400">Together</span>
            </span>
          </button>

          <nav className="flex items-center">
            <button onClick={onOpenChangeMovie} className={navBtn} title="انتخاب فیلم">
              <Film className="w-4 h-4 text-purple-400" />
              <span className="hidden md:inline">فیلم</span>
            </button>
            <button onClick={onOpenSchedule} className={navBtn} title="زمان‌بندی">
              <Calendar className="w-4 h-4 text-purple-400" />
              <span className="hidden md:inline">زمان‌بندی</span>
            </button>
            <button onClick={onOpenRooms} className={navBtn} title="اتاق‌ها">
              <DoorOpen className="w-4 h-4 text-purple-400" />
              <span className="hidden md:inline">اتاق‌ها</span>
            </button>
            {userRole === 'admin' && (
              <button onClick={onOpenAdminUsers} className={navBtn} title="مدیریت">
                <ShieldCheck className="w-4 h-4 text-purple-400" />
                <span className="hidden md:inline">مدیریت</span>
                {pendingUsersCount > 0 && (
                  <span className="px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">{pendingUsersCount}</span>
                )}
              </button>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 bg-[#121629]/90 border border-slate-800/80 rounded-full pr-3 pl-1 py-1 text-xs min-w-0">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <strong className="text-white truncate max-w-[90px] sm:max-w-[160px]">{roomName}</strong>
            <button onClick={handleCopyLink} title="کپی لینک دعوت" className="p-1 text-slate-400 hover:text-white rounded-full">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          <button
            onClick={onEditProfile}
            title={userName}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0 hover:ring-2 hover:ring-purple-400/50"
            style={{ backgroundColor: userColor || '#6d28d9' }}
          >
            {userAvatar || userName.slice(0, 2)}
          </button>
          {onLogout && (
            <button onClick={onLogout} title="خروج" className="hidden sm:block p-2 rounded-xl text-slate-400 hover:text-rose-300">
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
