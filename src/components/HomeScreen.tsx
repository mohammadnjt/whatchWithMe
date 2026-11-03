import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Plus,
  DoorOpen,
  Film,
  Users,
  Globe,
  Sun,
  Moon,
  LogOut,
  Sparkles,
  ShieldCheck,
  HardDrive,
  Check,
  Play,
  Radio,
} from 'lucide-react';
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
  movie?: {
    title: string;
    posterUrl?: string;
    genre?: string;
  };
  participantCount?: number;
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
  const [lang, setLang] = useState<'en' | 'fa'>(() => {
    return (localStorage.getItem('watchtogether_lang') as 'en' | 'fa') || 'en';
  });
  const [isLangOpen, setIsLangOpen] = useState(false);
  const [activeRooms, setActiveRooms] = useState<RoomInfo[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');

  // Switch language
  const handleToggleLang = (newLang: 'en' | 'fa') => {
    setLang(newLang);
    localStorage.setItem('watchtogether_lang', newLang);
    setIsLangOpen(false);
  };

  // Fetch active rooms on mount
  useEffect(() => {
    setIsLoadingRooms(true);
    fetch('/api/rooms')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: RoomInfo[]) => {
        if (Array.isArray(data)) {
          setActiveRooms(data);
        }
      })
      .catch(() => {
        // Fallback default sample rooms if server rooms empty
        setActiveRooms([
          { id: 'movie-night', name: 'Movie Night', participantCount: 3, movie: { title: 'Interstellar' } },
          { id: 'sci-fi-galaxy', name: 'Sci-Fi Club', participantCount: 1, movie: { title: 'Tears of Steel 4K' } },
        ]);
      })
      .finally(() => setIsLoadingRooms(false));
  }, []);

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    const code = roomCode.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
    if (!code) {
      showToast(lang === 'en' ? 'Please enter a valid room code' : 'لطفاً کد یا نام معتبری وارد کنید', 'warning');
      return;
    }
    onJoinRoom(code);
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newRoomName.trim() || (lang === 'en' ? 'Cinema Night' : 'شب سینما');
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `party-${Date.now().toString(36)}`;

    // Call API to create room (empty without dummy video)
    fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: slug,
        name: name,
        movie: null,
        hostId: currentUser.id,
      }),
    })
      .then(() => {
        showToast(
          lang === 'en' ? `Room "${name}" created!` : `اتاق «${name}» با موفقیت ایجاد شد!`,
          'success'
        );
        onJoinRoom(slug);
      })
      .catch(() => {
        onJoinRoom(slug);
      });
  };

  const isRtl = lang === 'fa';

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="relative min-h-screen w-full bg-[#060813] text-slate-100 flex flex-col justify-between overflow-x-hidden selection:bg-purple-600 selection:text-white"
    >
      {/* Background Image Layer: AVIF with WebP / PNG / JPG fallback */}
      <div
        className="fixed inset-0 pointer-events-none bg-cover bg-right md:bg-[position:75%_center] lg:bg-center transition-opacity duration-700"
        style={{
          backgroundImage: `url('/assets/bg-home.avif'), url('/assets/bg-home.webp'), url('/assets/bg-home.jpg'), url('/assets/aistudio/image_f9441923.png')`,
        }}
      >
        {/* Left-side cinematic dark gradient scrim to ensure pixel-perfect legibility for UI */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#060813] via-[#060813]/95 via-40% md:via-48% to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#060813] via-transparent to-[#060813]/70" />
      </div>

      {/* Top Navigation Bar */}
      <header className="relative z-20 w-full px-6 sm:px-10 lg:px-14 py-6 flex items-center justify-between">
        {/* Brand Logo */}
        <div className="flex items-center gap-3 cursor-pointer group">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-purple-600/40 group-hover:scale-105 transition-transform">
            <Play className="w-5 h-5 text-white fill-white ml-0.5" />
          </div>
          <span className="font-extrabold text-xl sm:text-2xl tracking-tight text-white drop-shadow-sm">
            Watch<span className="text-purple-400">Together</span>
          </span>
        </div>

        {/* Right Navigation & Controls */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Admin Tools Pill */}
          {currentUser.role === 'admin' && onOpenAdminUsers && (
            <button
              onClick={onOpenAdminUsers}
              className="relative hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-950/60 border border-purple-500/40 text-purple-200 text-xs font-semibold hover:bg-purple-900/70 hover:border-purple-400 transition-all shadow-md shadow-purple-950/50"
            >
              <Users className="w-3.5 h-3.5 text-purple-300" />
              <span>{lang === 'en' ? 'Manage Users' : 'مدیریت کاربران'}</span>
              {pendingUsersCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold animate-pulse">
                  {pendingUsersCount}
                </span>
              )}
            </button>
          )}

          {/* Theme Toggle (Sun / Moon indicator) */}
          <div className="flex items-center bg-[#13162b]/80 border border-purple-500/20 backdrop-blur-md rounded-full p-1 shadow-lg shadow-purple-950/30">
            <button
              type="button"
              className="p-1.5 rounded-full text-slate-400 hover:text-white transition-colors"
              title="Light theme"
            >
              <Sun className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="p-1.5 rounded-full bg-purple-600/30 text-purple-300 shadow-inner"
              title="Dark theme"
            >
              <Moon className="w-4 h-4" />
            </button>
          </div>

          {/* Language Selector Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsLangOpen(!isLangOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#13162b]/80 border border-purple-500/20 backdrop-blur-md rounded-full text-xs sm:text-sm font-semibold text-slate-200 hover:text-white hover:border-purple-500/40 transition-all shadow-lg shadow-purple-950/30"
            >
              <Globe className="w-4 h-4 text-purple-400" />
              <span>{lang === 'en' ? 'EN' : 'فا'}</span>
              <span className="text-[10px] text-slate-400">▼</span>
            </button>

            {isLangOpen && (
              <div className="absolute right-0 mt-2 w-32 bg-[#13162b] border border-purple-500/30 rounded-xl shadow-2xl py-1 z-50 text-xs backdrop-blur-xl">
                <button
                  onClick={() => handleToggleLang('en')}
                  className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-purple-600/20 ${
                    lang === 'en' ? 'text-purple-300 font-bold' : 'text-slate-300'
                  }`}
                >
                  <span>English</span>
                  {lang === 'en' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                </button>
                <button
                  onClick={() => handleToggleLang('fa')}
                  className={`w-full px-3 py-2 text-right flex items-center justify-between hover:bg-purple-600/20 ${
                    lang === 'fa' ? 'text-purple-300 font-bold' : 'text-slate-300'
                  }`}
                >
                  <span>فارسی</span>
                  {lang === 'fa' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                </button>
              </div>
            )}
          </div>

          {/* User Profile & Logout */}
          <div className="flex items-center gap-2 pl-1">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-md border border-white/20"
              style={{ backgroundColor: currentUser.color || '#8b5cf6' }}
              title={currentUser.displayName}
            >
              {currentUser.avatar || currentUser.displayName.slice(0, 1).toUpperCase()}
            </div>
            <button
              onClick={onLogout}
              className="p-2 rounded-full text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              title={lang === 'en' ? 'Log out' : 'خروج'}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Hero Section */}
      <main className="relative z-10 w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-14 py-8 sm:py-16 flex-1 flex flex-col justify-center">
        <div className="max-w-xl flex flex-col items-start gap-6">
          {/* Emblem Icon (3 People with glowing Play Button & Radiating Rays) */}
          <div className="relative group">
            <div className="absolute -inset-3 bg-purple-600/30 rounded-full blur-xl opacity-75 group-hover:opacity-100 transition duration-500" />
            <div className="relative w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center">
              <svg
                viewBox="0 0 100 100"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full drop-shadow-[0_0_16px_rgba(168,85,247,0.8)]"
              >
                {/* Radiating Ray Beams at Top */}
                <path d="M50 8 V16" stroke="#c084fc" strokeWidth="3" strokeLinecap="round" />
                <path d="M36 12 L40 18" stroke="#c084fc" strokeWidth="3" strokeLinecap="round" />
                <path d="M64 12 L60 18" stroke="#c084fc" strokeWidth="3" strokeLinecap="round" />

                {/* Left Silhouette */}
                <circle cx="32" cy="34" r="8" stroke="#818cf8" strokeWidth="3.5" />
                <path
                  d="M20 54 C20 45 25 43 33 43"
                  stroke="#818cf8"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />

                {/* Right Silhouette */}
                <circle cx="68" cy="34" r="8" stroke="#818cf8" strokeWidth="3.5" />
                <path
                  d="M80 54 C80 45 75 43 67 43"
                  stroke="#818cf8"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />

                {/* Center Silhouette (Taller) */}
                <circle cx="50" cy="30" r="10" stroke="#c084fc" strokeWidth="4" />
                <path
                  d="M32 58 C32 46 39 44 50 44 C61 44 68 46 68 58"
                  stroke="#c084fc"
                  strokeWidth="4"
                  strokeLinecap="round"
                />

                {/* Glowing Center Play Badge */}
                <circle cx="50" cy="52" r="11" fill="#4f46e5" stroke="#a855f7" strokeWidth="3" />
                <polygon points="47,47 56,52 47,57" fill="#ffffff" />
              </svg>
            </div>
          </div>

          {/* Heading */}
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-[1.1]">
            Watch{' '}
            <span className="bg-gradient-to-r from-purple-400 via-indigo-300 to-purple-500 bg-clip-text text-transparent drop-shadow-sm">
              Together
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-base sm:text-lg text-slate-300/90 leading-relaxed font-normal max-w-lg">
            {lang === 'en'
              ? 'Create or join a room and enjoy movies together, synced perfectly.'
              : 'اتاق بسازید یا وارد شوید و فیلم‌ها را در هماهنگی کامل و زنده با هم تماشا کنید.'}
          </p>

          {/* Join Room Input Bar */}
          <form onSubmit={handleJoinByCode} className="w-full max-w-md mt-2">
            <div className="relative flex items-center bg-[#13162b]/90 border border-purple-500/30 hover:border-purple-500/50 focus-within:border-purple-400 backdrop-blur-xl rounded-2xl p-2 shadow-2xl shadow-purple-950/60 transition-all">
              {/* Left Key / Room Icon */}
              <div className="w-10 h-10 rounded-xl bg-purple-900/30 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0 mx-1">
                <DoorOpen className="w-5 h-5" />
              </div>

              {/* Input field */}
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                placeholder={lang === 'en' ? 'Enter a room code...' : 'کد یا نام اتاق را وارد کنید...'}
                className="w-full bg-transparent px-3 py-2 text-sm sm:text-base text-white placeholder-slate-400 focus:outline-none"
              />

              {/* Arrow Submit Button */}
              <button
                type="submit"
                className="w-11 h-11 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-violet-600 hover:from-purple-500 hover:to-indigo-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-purple-600/40 hover:scale-105 active:scale-95 transition-all"
                title={lang === 'en' ? 'Join Room' : 'ورود به اتاق'}
              >
                {isRtl ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
              </button>
            </div>
          </form>

          {/* "or" Divider */}
          <div className="w-full max-w-md flex items-center gap-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <div className="flex-1 h-px bg-slate-800/80" />
            <span>{lang === 'en' ? 'or' : 'یا'}</span>
            <div className="flex-1 h-px bg-slate-800/80" />
          </div>

          {/* Create a New Room Button */}
          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="w-full max-w-md py-3.5 px-6 rounded-full border border-purple-500/40 bg-purple-950/20 hover:bg-purple-900/40 hover:border-purple-400 text-purple-200 hover:text-white font-medium text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-lg shadow-purple-950/30 transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            <Plus className="w-4 h-4 text-purple-400" />
            <span>{lang === 'en' ? 'Create a New Room' : 'ساخت اتاق جدید'}</span>
          </button>

          {/* Active Live Rooms Quick Access */}
          {activeRooms.length > 0 && (
            <div className="w-full max-w-md pt-4">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2.5">
                <span className="flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                  <span>{lang === 'en' ? 'Active Rooms' : 'اتاق‌های در حال پخش'}</span>
                </span>
                <span className="text-[11px] text-slate-500">
                  {activeRooms.length} {lang === 'en' ? 'available' : 'اتاق'}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {activeRooms.slice(0, 3).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onJoinRoom(r.id)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#101426]/80 hover:bg-[#161a33] border border-purple-500/20 hover:border-purple-500/40 flex items-center justify-between text-left transition-all group"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <div className="w-7 h-7 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0">
                        <Film className="w-3.5 h-3.5" />
                      </div>
                      <div className="truncate text-right">
                        <div className="text-xs sm:text-sm font-semibold text-white group-hover:text-purple-300 transition-colors truncate">
                          {r.name || r.id}
                        </div>
                        {r.movie?.title && (
                          <div className="text-[11px] text-slate-400 truncate">
                            {r.movie.title}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        <span>{r.participantCount || 1}</span>
                      </div>
                      <span className="text-purple-400 group-hover:translate-x-1 transition-transform">
                        {isRtl ? '←' : '→'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer info */}
      <footer className="relative z-10 w-full px-6 sm:px-10 py-4 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
        <span>© WatchTogether • Ultra-low Latency Video Sync</span>
        <span className="flex items-center gap-1 text-[11px] text-slate-400">
          <Sparkles className="w-3 h-3 text-purple-400" />
          <span>{lang === 'en' ? 'Push-To-Talk: Hold "M" to speak' : 'Push-To-Talk: برای صحبت کلید M را نگه‌دارید'}</span>
        </span>
      </footer>

      {/* Create Room Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#101426] border border-purple-500/30 rounded-2xl w-full max-w-md shadow-2xl p-6 relative">
            <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              <Plus className="w-5 h-5 text-purple-400" />
              <span>{lang === 'en' ? 'Create a New Room' : 'ساخت اتاق جدید'}</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              {lang === 'en'
                ? 'Name your room. Once inside, you can browse/upload your video file or paste a direct stream link.'
                : 'نام اتاق را وارد کنید. پس از ورود به اتاق می‌توانید فایل ویدیویی خود را انتخاب و آپلود کنید یا لینک ویدیو را قرار دهید.'}
            </p>

            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  {lang === 'en' ? 'Room Name' : 'نام اتاق'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={lang === 'en' ? 'e.g. Cinema Night' : 'مثلاً شب سینما'}
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#080a14] border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  {lang === 'en' ? 'Cancel' : 'انصراف'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30 transition-all"
                >
                  {lang === 'en' ? 'Create & Enter' : 'ساخت و ورود به اتاق'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
