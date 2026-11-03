import React, { useState, useRef, useEffect } from 'react';
import {
  Calendar,
  Clock,
  Users,
  Tv,
  Send,
  Smile,
  MoreVertical,
  Check,
  ChevronDown,
  Play,
  Film,
  Sparkles,
  Wifi,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Radio,
} from 'lucide-react';
import { MovieInfo, Participant, ChatMessage } from '../types';

interface MovieSidebarProps {
  movie: MovieInfo;
  scheduledTime: string | null;
  status: 'scheduled' | 'playing' | 'paused' | 'ended';
  participants: Participant[];
  currentUserId: string;
  selectedQuality: string;
  chatMessages: ChatMessage[];
  isMicActive?: boolean;
  isPushToTalkActive?: boolean;
  isOpenMic?: boolean;
  isVoiceBlocked?: boolean;
  isLocalSpeaking?: boolean;
  speakingUserIds?: Set<string>;
  locallyMutedUserIds?: Set<string>;
  onToggleMic?: () => void;
  onToggleOpenMic?: () => void;
  onResumeVoice?: () => void;
  onToggleMuteUser?: (userId: string, name?: string) => void;
  onQualityChange: (quality: string) => void;
  onSendMessage: (text: string) => void;
  onStartNow: () => void;
  onOpenSchedule: () => void;
  onOpenChangeMovie: () => void;
}

export const MovieSidebar: React.FC<MovieSidebarProps> = ({
  movie,
  scheduledTime,
  status,
  participants,
  currentUserId,
  selectedQuality,
  chatMessages,
  isMicActive = false,
  isPushToTalkActive = false,
  isOpenMic = false,
  isVoiceBlocked = false,
  isLocalSpeaking = false,
  speakingUserIds = new Set(),
  locallyMutedUserIds = new Set(),
  onToggleMic,
  onToggleOpenMic,
  onResumeVoice,
  onToggleMuteUser,
  onQualityChange,
  onSendMessage,
  onStartNow,
  onOpenSchedule,
  onOpenChangeMovie,
}) => {
  const [inputText, setInputText] = useState('');
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [countdownText, setCountdownText] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Scheduled watch party countdown calculation
  useEffect(() => {
    if (!scheduledTime || status === 'playing') {
      setCountdownText(null);
      return;
    }

    const updateTimer = () => {
      const diff = new Date(scheduledTime).getTime() - Date.now();
      if (diff <= 0) {
        setCountdownText('Starting now!');
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setCountdownText(`${mins}:${secs.toString().padStart(2, '0')}`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [scheduledTime, status]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  const insertEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    setShowEmojiPicker(false);
  };

  const qualities = ['4K Ultra HD', '1080p Full HD', '720p HD', '480p SD', '360p Data Saver', 'Auto Adaptive'];

  const formattedStartedTime = () => {
    if (scheduledTime) {
      try {
        const d = new Date(scheduledTime);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      } catch {
        return '—';
      }
    }
    return '—';
  };

  return (
    <aside className="w-full lg:w-[380px] xl:w-[420px] flex flex-col gap-4 sm:gap-5 shrink-0">
      {/* 1. Movie Information Card (Matching design screenshot) */}
      <div className="bg-[#12162a]/90 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-xl relative overflow-hidden">
        <div className="flex gap-4">
          {/* Movie Poster */}
          <div className="w-20 sm:w-24 h-28 sm:h-32 rounded-xl overflow-hidden bg-slate-900 border border-slate-700/60 shrink-0 shadow-lg relative group">
            {movie.posterUrl ? (
              <img
                src={movie.posterUrl}
                alt={movie.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-purple-950/30 text-purple-400 p-2 text-center">
                <Film className="w-7 h-7 mb-1" />
                <span className="text-[10px] leading-tight text-slate-400">بدون فیلم</span>
              </div>
            )}
            <button
              onClick={onOpenChangeMovie}
              title="Change Movie"
              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs text-purple-300 font-medium transition-opacity"
            >
              Change
            </button>
          </div>

          {/* Movie Details */}
          <div className="flex-1 flex flex-col justify-center min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">
              {movie.title}
            </h2>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
              <span>🎬 {movie.year}</span>
              <span>•</span>
              <span className="truncate">{movie.genre}</span>
            </div>
            <p className="text-xs text-slate-400 mt-2 line-clamp-2 leading-relaxed">
              {movie.tagline}
            </p>
          </div>
        </div>

        {/* Watch Party Time Sub-Card */}
        <div className="mt-4 pt-4 border-t border-slate-800/80">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Calendar className="w-3.5 h-3.5 text-purple-400" />
              <span>Watch Party Time</span>
            </div>
            {countdownText ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Starts in {countdownText}
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Started
              </span>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>Started at</span>
              <span className="text-slate-200 font-medium font-mono">{formattedStartedTime()}</span>
            </div>
            {countdownText && (
              <button
                onClick={onStartNow}
                className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg text-xs shadow-md shadow-purple-600/30 transition-all flex items-center gap-1"
              >
                <Play className="w-3 h-3 fill-white" />
                <span>Start Now</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Participants & Live Voice Chat Section */}
      <div className="bg-[#12162a]/90 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-xl">
        {/* Header & Participant Count */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Users className="w-4 h-4 text-purple-400" />
            <span>Participants ({participants.filter((p) => p.online).length} online)</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            {isOpenMic ? (
              <span className="px-1.5 py-0.5 rounded bg-emerald-600/25 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold" title="میکروفون تا پایان نشست باز می‌ماند">
                میکروفون همیشه باز
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-purple-600/25 border border-purple-500/30 text-purple-300 text-[10px] font-mono font-semibold" title="نگه‌داشتن کلید M برای صحبت (Push-to-Talk)">
                کلید M = صحبت
              </span>
            )}
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span>گفتگوی صوتی</span>
          </div>
        </div>

        {/* Live Voice Chat Bar */}
        <div className={`mb-3.5 p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 shadow-inner ${
          isPushToTalkActive
            ? 'bg-emerald-950/40 border-emerald-500/60 shadow-emerald-900/30'
            : isMicActive
            ? 'bg-[#0e1628] border-emerald-500/30'
            : 'bg-[#0b0e1d] border-slate-800/90'
        }`}>
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={onToggleMic}
              className={`p-2 rounded-xl flex items-center gap-2 text-xs font-bold transition-all cursor-pointer shadow-md ${
                isPushToTalkActive
                  ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-400 animate-pulse'
                  : isMicActive
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500/30'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-700 border border-slate-700/80'
              }`}
              title={isMicActive ? 'میکروفون فعال است (کلیک برای قطع میکروفون)' : 'روشن کردن میکروفون یا نگه‌داشتن کلید M برای صحبت'}
            >
              {isMicActive ? (
                <>
                  <Mic className="w-4 h-4 text-emerald-400 animate-pulse" />
                  <span className="truncate">{isPushToTalkActive ? 'کلید M فعال' : 'میکروفون روشن'}</span>
                </>
              ) : (
                <>
                  <MicOff className="w-4 h-4 text-slate-400" />
                  <span className="truncate">میکروفون خاموش</span>
                </>
              )}
            </button>

            {/* Speaking Audio Wave Animation */}
            {isMicActive && (
              <div className="flex items-center gap-0.5 px-2">
                <span className={`w-1 rounded-full bg-emerald-400 transition-all duration-150 ${isLocalSpeaking || isPushToTalkActive ? 'h-4 animate-bounce' : 'h-1.5'}`} />
                <span className={`w-1 rounded-full bg-emerald-400 transition-all duration-150 delay-75 ${isLocalSpeaking || isPushToTalkActive ? 'h-6 animate-bounce' : 'h-2'}`} />
                <span className={`w-1 rounded-full bg-emerald-400 transition-all duration-150 delay-150 ${isLocalSpeaking || isPushToTalkActive ? 'h-3 animate-bounce' : 'h-1.5'}`} />
              </div>
            )}
          </div>

          <div className="text-[11px] text-slate-400 text-left shrink-0">
            {isPushToTalkActive ? (
              <span className="text-emerald-400 font-bold animate-pulse">در حال صحبت (M)...</span>
            ) : isMicActive ? (
              <span className="text-emerald-400 font-medium">صدایتان پخش می‌شود</span>
            ) : isOpenMic ? (
              <span className="text-slate-400">در حال اتصال میکروفون…</span>
            ) : (
              <span className="text-slate-400">کلیک یا نگه‌داشتن M</span>
            )}
          </div>
        </div>

        {/* Open mic: speak without holding M for the whole session. */}
        <label
          className="mb-3.5 flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-[#0b0e1d] border border-slate-800/90 cursor-pointer hover:border-slate-700"
          title="میکروفون باز می‌ماند و برای صحبت لازم نیست کلید M را نگه دارید"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Mic className={`w-3.5 h-3.5 shrink-0 ${isOpenMic ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className="text-[11px] text-slate-300 truncate">
              میکروفون همیشه باز باشد <span className="text-slate-500">(بدون نگه‌داشتن M)</span>
            </span>
          </span>
          <span className="relative inline-flex shrink-0">
            <input
              type="checkbox"
              checked={isOpenMic}
              onChange={() => onToggleOpenMic?.()}
              className="sr-only peer"
            />
            <span className="w-9 h-5 rounded-full bg-slate-700 peer-checked:bg-emerald-500/80 transition-colors" />
            <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
          </span>
        </label>

        {/* Browsers refuse to start audio before the page is interacted with. */}
        {isVoiceBlocked && (
          <button
            onClick={() => onResumeVoice?.()}
            className="mb-3.5 w-full px-2.5 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-[11px] text-amber-300 font-semibold hover:bg-amber-500/25 transition-colors"
          >
            مرورگر پخش صدا را مسدود کرده است — برای شنیدن صدای بقیه کلیک کنید
          </button>
        )}

        {/* Participants List */}
        <div className="space-y-2 max-h-[190px] overflow-y-auto pr-1 select-none scrollbar-thin">
          {participants.map((p) => {
            const isMe = p.id === currentUserId;
            const isSpeaking = (speakingUserIds.has(p.id) || p.isSpeaking || (isMe && isLocalSpeaking));
            const isMutedLocally = locallyMutedUserIds.has(p.id);

            return (
              <div
                key={p.id}
                className={`flex items-center justify-between py-1.5 px-2 rounded-xl transition-all border ${
                  isSpeaking
                    ? 'bg-emerald-950/20 border-emerald-500/40'
                    : 'bg-[#151930]/40 hover:bg-[#181d38]/80 border-slate-800/60'
                }`}
              >
                {/* Left: Avatar + Name + Speaking Ring */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="relative">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs text-white shadow transition-all ${
                        isSpeaking ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-[#12162a] animate-pulse' : ''
                      }`}
                      style={{ backgroundColor: p.color || '#8b5cf6' }}
                    >
                      {p.avatar || p.name.slice(0, 2).toUpperCase()}
                    </div>
                    {p.online && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#12162a]" />
                    )}
                  </div>

                  <div className="min-w-0 flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-medium truncate max-w-[110px] sm:max-w-[130px] ${isMe ? 'text-purple-300 font-bold' : 'text-slate-200'}`}>
                        {p.name}
                      </span>
                      {isMe && (
                        <span className="text-[10px] text-purple-400 font-semibold">(شما)</span>
                      )}
                    </div>
                    {isSpeaking && (
                      <span className="text-[9px] text-emerald-400 font-medium">در حال صحبت...</span>
                    )}
                    {isMutedLocally && !isMe && (
                      <span className="text-[9px] text-rose-400 font-medium">توسط شما بی‌صدا شد</span>
                    )}
                  </div>
                </div>

                {/* Right: Mic status indicator, Quality, and Local Mute Button */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Participant Mic Status */}
                  <div
                    className={`p-1 rounded-md text-[10px] ${
                      (isMe ? isMicActive : p.isMicOn)
                        ? 'text-emerald-400 bg-emerald-500/10'
                        : 'text-slate-500 bg-slate-800/40'
                    }`}
                    title={(isMe ? isMicActive : p.isMicOn) ? 'میکروفون روشن است' : 'میکروفون خاموش است'}
                  >
                    {(isMe ? isMicActive : p.isMicOn) ? (
                      <Mic className="w-3.5 h-3.5" />
                    ) : (
                      <MicOff className="w-3.5 h-3.5" />
                    )}
                  </div>

                  {/* Quality Badge */}
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-tight ${
                      p.quality?.includes('1080p') || p.quality?.includes('4K')
                        ? 'bg-purple-600/30 text-purple-300 border border-purple-500/30'
                        : p.quality?.includes('720p')
                        ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {p.quality || '1080p'}
                  </span>

                  {/* Individual Mute/Unmute Button for each other participant */}
                  {!isMe ? (
                    <button
                      onClick={() => onToggleMuteUser && onToggleMuteUser(p.id, p.name)}
                      className={`p-1.5 rounded-lg text-xs transition-all cursor-pointer border ${
                        isMutedLocally
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                          : 'bg-slate-800/70 text-slate-400 hover:text-slate-200 hover:bg-slate-700 border-slate-700/80'
                      }`}
                      title={
                        isMutedLocally
                          ? `صدای ${p.name} برای شما قطع است (کلیک برای وصل مجدد صدا)`
                          : `قطع صدای ${p.name} برای شما (میوت محلی)`
                      }
                    >
                      {isMutedLocally ? (
                        <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Video Quality Selector (Allows independent quality selection as required) */}
      <div className="bg-[#12162a]/90 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <Tv className="w-4 h-4 text-purple-400" />
            <span>Video Quality</span>
          </div>

          <div className="relative">
            <button
              onClick={() => setQualityMenuOpen(!qualityMenuOpen)}
              className="flex items-center gap-2 bg-[#0c1020] border border-slate-700 hover:border-purple-500/50 rounded-lg px-3 py-1.5 text-xs font-mono font-medium text-slate-200 shadow-sm transition-all"
            >
              <span>{selectedQuality}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {qualityMenuOpen && (
              <div className="absolute right-0 bottom-full mb-1 w-48 bg-[#0e1224] border border-slate-700/80 rounded-xl shadow-2xl p-1.5 z-50">
                <div className="px-2 py-1 text-[10px] text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800">
                  Select Stream Quality
                </div>
                {qualities.map((q) => {
                  const shortLabel = q.split(' ')[0];
                  return (
                    <button
                      key={q}
                      onClick={() => {
                        onQualityChange(shortLabel);
                        setQualityMenuOpen(false);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between ${
                        selectedQuality === shortLabel
                          ? 'bg-purple-600/30 text-purple-300 font-bold'
                          : 'text-slate-300 hover:bg-slate-800/70'
                      }`}
                    >
                      <span>{q}</span>
                      {selectedQuality === shortLabel && <Check className="w-3.5 h-3.5 text-purple-400" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. Chat Section (Matching screenshot) */}
      <div className="bg-[#12162a]/90 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-xl flex-1 flex flex-col min-h-[260px] max-h-[340px]">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            <span>Live Chat</span>
          </div>
          <span className="text-[11px] text-slate-500">Real-time sync</span>
        </div>

        {/* Messages List */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 text-xs scrollbar-thin">
          {chatMessages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-xs italic">
              Say hi to your watch party!
            </div>
          ) : (
            chatMessages.map((msg) => {
              const isMe = msg.senderId === currentUserId;
              return (
                <div key={msg.id} className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-[10px] text-purple-300 shrink-0 mt-0.5">
                    {msg.avatar || msg.senderName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className={`font-semibold text-[11px] ${isMe ? 'text-purple-300' : 'text-slate-200'}`}>
                        {msg.senderName}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-slate-300 mt-0.5 text-xs leading-relaxed break-words bg-[#0e1224]/70 rounded-lg px-2.5 py-1.5 border border-slate-800/50">
                      {msg.text}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSend} className="mt-3 relative flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type a message..."
              className="w-full bg-[#0c1020] border border-slate-700/80 rounded-xl px-3.5 py-2 pr-9 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/80 transition-colors shadow-inner"
            />
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-yellow-400 transition-colors"
              title="Add Emoji"
            >
              <Smile className="w-4 h-4" />
            </button>

            {/* Quick Emoji Picker */}
            {showEmojiPicker && (
              <div className="absolute right-0 bottom-full mb-2 bg-[#101426] border border-slate-700 p-2 rounded-xl shadow-xl flex gap-1 z-50 text-base">
                {['🍿', '🚀', '🎬', '🔥', '😂', '👏', '😱', '❤️'].map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => insertEmoji(em)}
                    className="p-1 hover:bg-slate-800 rounded transition-colors"
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!inputText.trim()}
            className="w-8 h-8 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:hover:bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-lg shadow-purple-600/30 transition-all active:scale-95"
            title="Send Message"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </aside>
  );
};
