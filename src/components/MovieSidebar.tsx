import React, { useState, useRef, useEffect } from 'react';
import { Users, Send, Smile, Play, Film, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { MovieInfo, Participant, ChatMessage } from '../types';

interface MovieSidebarProps {
  movie: MovieInfo | null;
  scheduledTime: string | null;
  status: 'scheduled' | 'playing' | 'paused' | 'ended';
  participants: Participant[];
  currentUserId: string;
  chatMessages: ChatMessage[];
  isMicActive?: boolean;
  isPushToTalkActive?: boolean;
  isLocalSpeaking?: boolean;
  speakingUserIds?: Set<string>;
  locallyMutedUserIds?: Set<string>;
  onToggleMic?: () => void;
  onToggleMuteUser?: (userId: string, name?: string) => void;
  onSendMessage: (text: string) => void;
  onStartNow: () => void;
  onOpenChangeMovie: () => void;
}

const card = 'bg-[#12162a]/90 border border-slate-800/80 rounded-2xl p-4';

export const MovieSidebar: React.FC<MovieSidebarProps> = ({
  movie,
  scheduledTime,
  status,
  participants,
  currentUserId,
  chatMessages,
  isMicActive = false,
  isPushToTalkActive = false,
  isLocalSpeaking = false,
  speakingUserIds = new Set(),
  locallyMutedUserIds = new Set(),
  onToggleMic,
  onToggleMuteUser,
  onSendMessage,
  onStartNow,
  onOpenChangeMovie,
}) => {
  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chatMessages]);

  useEffect(() => {
    if (!scheduledTime || status !== 'scheduled') {
      setCountdown(null);
      return;
    }
    const update = () => {
      const diff = new Date(scheduledTime).getTime() - Date.now();
      if (diff <= 0) {
        setCountdown('الان');
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${h > 0 ? `${h}:` : ''}${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [scheduledTime, status]);

  const online = participants.filter((p) => p.online);

  return (
    <aside className="w-full lg:w-[360px] xl:w-[400px] flex flex-col gap-4 shrink-0" dir="rtl">
      {/* Movie */}
      <div className={card}>
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenChangeMovie}
            title="تغییر فیلم"
            className="w-14 h-20 rounded-xl overflow-hidden bg-purple-950/30 border border-slate-700/60 shrink-0 flex items-center justify-center hover:border-purple-500"
          >
            {movie?.posterUrl ? (
              <img src={movie.posterUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <Film className="w-6 h-6 text-purple-400" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-white truncate">{movie?.title || 'فیلمی انتخاب نشده'}</h2>
            {countdown ? (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs text-amber-300 font-mono">شروع تا {countdown}</span>
                <button
                  onClick={onStartNow}
                  className="px-2 py-0.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1"
                >
                  <Play className="w-3 h-3 fill-white" />
                  شروع الان
                </button>
              </div>
            ) : (
              movie && <span className="text-xs text-slate-400 mt-1 block">{status === 'paused' ? 'متوقف' : 'در حال پخش'}</span>
            )}
          </div>
        </div>
      </div>

      {/* Participants & voice */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Users className="w-4 h-4 text-purple-400" />
            حاضرین ({online.length})
          </div>
          <button
            onClick={onToggleMic}
            title="کلیک یا نگه‌داشتن کلید M"
            className={`px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-bold border ${
              isMicActive
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border-slate-700/80'
            } ${isPushToTalkActive ? 'animate-pulse' : ''}`}
          >
            {isMicActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            {isMicActive ? 'میکروفون روشن' : 'میکروفون'}
          </button>
        </div>

        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
          {online.map((p) => {
            const isMe = p.id === currentUserId;
            const isSpeaking = speakingUserIds.has(p.id) || p.isSpeaking || (isMe && isLocalSpeaking);
            const isMuted = locallyMutedUserIds.has(p.id);
            const micOn = isMe ? isMicActive : p.isMicOn;
            return (
              <div
                key={p.id}
                className={`flex items-center justify-between py-1.5 px-2 rounded-xl border ${
                  isSpeaking ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-[#151930]/40 border-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0 ${
                      isSpeaking ? 'ring-2 ring-emerald-400' : ''
                    }`}
                    style={{ backgroundColor: p.color || '#8b5cf6' }}
                  >
                    {p.avatar || p.name.slice(0, 2)}
                  </div>
                  <span className={`text-xs truncate ${isMe ? 'text-purple-300 font-bold' : 'text-slate-200'}`}>
                    {p.name}
                    {isMe && ' (شما)'}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {micOn ? <Mic className="w-3.5 h-3.5 text-emerald-400" /> : <MicOff className="w-3.5 h-3.5 text-slate-600" />}
                  {!isMe && (
                    <button
                      onClick={() => onToggleMuteUser?.(p.id, p.name)}
                      title={isMuted ? 'وصل صدا' : 'قطع صدا برای من'}
                      className={`p-1 rounded-lg ${isMuted ? 'text-rose-400 bg-rose-500/15' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat */}
      <div className={`${card} flex flex-col h-[320px]`}>
        <div className="flex-1 overflow-y-auto space-y-2.5 text-xs">
          {chatMessages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500">پیامی نیست.</div>
          ) : (
            chatMessages.map((msg) => (
              <div key={msg.id} className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center font-bold text-[10px] text-purple-300 shrink-0 mt-0.5">
                  {msg.avatar || msg.senderName.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className={`font-semibold text-[11px] ${msg.senderId === currentUserId ? 'text-purple-300' : 'text-slate-200'}`}>
                      {msg.senderName}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(msg.timestamp).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-slate-300 mt-0.5 break-words">{msg.text}</p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!inputText.trim()) return;
            onSendMessage(inputText);
            setInputText('');
          }}
          className="mt-3 flex items-center gap-2"
        >
          <div className="relative flex-1">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="پیام…"
              className="w-full bg-[#0c1020] border border-slate-700/80 rounded-xl px-3 py-2 pl-9 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/80"
            />
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-yellow-400"
            >
              <Smile className="w-4 h-4" />
            </button>
            {showEmojiPicker && (
              <div className="absolute left-0 bottom-full mb-2 bg-[#101426] border border-slate-700 p-2 rounded-xl flex gap-1 z-50 text-base">
                {['🍿', '🎬', '🔥', '😂', '👏', '😱', '❤️'].map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => {
                      setInputText((prev) => prev + em);
                      setShowEmojiPicker(false);
                    }}
                    className="p-1 hover:bg-slate-800 rounded"
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
            className="w-8 h-8 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white flex items-center justify-center shrink-0"
          >
            <Send className="w-3.5 h-3.5 -scale-x-100" />
          </button>
        </form>
      </div>
    </aside>
  );
};
