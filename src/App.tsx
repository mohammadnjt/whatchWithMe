/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { VideoPlayer } from './components/VideoPlayer';
import { PlayerStatsBar } from './components/PlayerStatsBar';
import { MovieSidebar } from './components/MovieSidebar';
import { ChangeMovieModal } from './components/ChangeMovieModal';
import { ScheduleModal } from './components/ScheduleModal';
import { RoomsModal } from './components/RoomsModal';
import { ProfileModal } from './components/ProfileModal';
import { useWatchTogetherSync } from './hooks/useWatchTogetherSync';
import { MessageSquare, Users, Film, Info, Radio, Sparkles } from 'lucide-react';

export default function App() {
  // Read room from URL query or default to 'movie-night' (matches design screenshot)
  const [roomId, setRoomId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || 'movie-night';
  });

  // User state
  const [user, setUser] = useState({
    id: 'user-mohammad',
    name: 'Mohammad (You)',
    avatar: 'MN',
    color: '#8b5cf6',
    quality: '1080p',
  });

  // Modals state
  const [isChangeMovieOpen, setIsChangeMovieOpen] = useState(false);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isRoomsOpen, setIsRoomsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // Mobile active tab: 'overview' | 'participants' | 'chat'
  const [mobileTab, setMobileTab] = useState<'overview' | 'chat' | 'participants'>('overview');

  // WebSocket Sync Hook
  const {
    room,
    participants,
    chatMessages,
    latencyMs,
    isConnected,
    videoRef,
    toastNotification,
    sendVideoAction,
    sendChatMessage,
    changeQuality,
    updateMovie,
    updateSchedule,
    showToast,
  } = useWatchTogetherSync({
    roomId,
    user,
  });

  // Keep URL updated when room changes
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('room') !== roomId) {
      url.searchParams.set('room', roomId);
      window.history.replaceState({}, '', url.toString());
    }
  }, [roomId]);

  // Handle user quality change
  const handleQualityChange = (newQuality: string) => {
    setUser((prev) => ({ ...prev, quality: newQuality }));
    changeQuality(newQuality);
    showToast(`Video quality set to ${newQuality} (stream adapts locally)`, 'info');
  };

  // Fallback movie if room is still initializing
  const currentMovie = room?.movie || {
    title: 'Interstellar',
    year: '2014',
    genre: 'Sci-Fi, Drama',
    tagline: 'Mankind was born on Earth. It was never meant to die here.',
    posterUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=800&auto=format&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    duration: 8910,
  };

  return (
    <div className="min-h-screen bg-[#0a0d18] text-slate-100 flex flex-col font-sans selection:bg-purple-600 selection:text-white">
      {/* Toast Notification Banner */}
      {toastNotification && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 animate-bounce duration-300">
          <div
            className={`px-4 py-2 rounded-xl backdrop-blur-md shadow-2xl border text-xs sm:text-sm font-semibold flex items-center gap-2 ${
              toastNotification.variant === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300'
                : toastNotification.variant === 'warning'
                ? 'bg-amber-950/90 border-amber-500/50 text-amber-300'
                : 'bg-[#151930]/95 border-purple-500/40 text-purple-200 shadow-purple-900/30'
            }`}
          >
            <Sparkles className="w-4 h-4 shrink-0 text-purple-400" />
            <span>{toastNotification.text}</span>
          </div>
        </div>
      )}

      {/* Top Navigation */}
      <Navbar
        roomName={room?.name || 'Movie Night'}
        roomId={roomId}
        userName={user.name}
        userAvatar={user.avatar}
        onOpenRooms={() => setIsRoomsOpen(true)}
        onOpenChangeMovie={() => setIsChangeMovieOpen(true)}
        onOpenSchedule={() => setIsScheduleOpen(true)}
        onEditProfile={() => setIsProfileOpen(true)}
        showToast={showToast}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col gap-6">
        {/* Connection status banner if reconnecting */}
        {!isConnected && (
          <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2 flex items-center justify-between text-xs text-amber-300">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>Connecting to WatchTogether ultra-low latency sync server...</span>
            </div>
            <span className="text-[11px] opacity-80">Auto-reconnecting</span>
          </div>
        )}

        {/* Responsive Layout: Player on Left + Details/Chat Sidebar on Right */}
        <div className="flex flex-col lg:flex-row gap-5 lg:gap-6 items-start">
          {/* Left Column: Player & Stats */}
          <div className="flex-1 w-full min-w-0 flex flex-col">
            <VideoPlayer
              videoRef={videoRef}
              videoUrl={currentMovie.videoUrl}
              posterUrl={currentMovie.posterUrl}
              title={currentMovie.title}
              isPlaying={room?.isPlaying || false}
              currentTime={room?.currentTime || 0}
              duration={currentMovie.duration}
              latencyMs={latencyMs}
              onPlayAction={sendVideoAction}
              showToast={showToast}
            />

            {/* Bottom 3 Cards + Audio Visualizer (Desktop view) */}
            <div className="hidden sm:block">
              <PlayerStatsBar
                viewerCount={participants.filter((p) => p.online).length || 5}
                latencyMs={latencyMs}
                isAutoSyncActive={true}
                isPlaying={room?.isPlaying || false}
              />
            </div>

            {/* Persian / English Feature Highlights Guide */}
            <div className="mt-4 p-4 rounded-2xl bg-[#0e1224]/70 border border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-400">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-purple-600/20 text-purple-400 flex items-center justify-center shrink-0">
                  <Radio className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-semibold text-slate-200">
                    Real-time WebSocket Auto-Sync & Drift Correction
                  </span>
                  <p className="text-[11px] text-slate-400">
                    همگام‌سازی لحظه‌ای فریم به فریم بین تمام تماشاچیان؛ اگر هر شخصی فیلم را استپ یا جابجا کند، برای همه فوراً همگام می‌شود.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setIsChangeMovieOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                >
                  تغییر فیلم یا لینک
                </button>
                <button
                  onClick={() => setIsScheduleOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 text-xs font-medium border border-purple-500/40 transition-colors"
                >
                  زمان‌بندی / شروع یهویی
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Tab Switcher */}
          <div className="w-full flex lg:hidden items-center justify-center gap-1 bg-[#12162a] p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setMobileTab('overview')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                mobileTab === 'overview'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Movie Info</span>
            </button>
            <button
              onClick={() => setMobileTab('participants')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                mobileTab === 'participants'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Participants ({participants.filter((p) => p.online).length})</span>
            </button>
            <button
              onClick={() => setMobileTab('chat')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                mobileTab === 'chat'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat ({chatMessages.length})</span>
            </button>
          </div>

          {/* Right Column: Movie Info, Participants, Quality & Live Chat */}
          <div className={`w-full lg:w-auto ${mobileTab === 'overview' ? 'block' : 'hidden lg:block'}`}>
            <MovieSidebar
              movie={currentMovie}
              scheduledTime={room?.scheduledTime || null}
              status={room?.status || 'playing'}
              participants={participants}
              currentUserId={user.id}
              selectedQuality={user.quality}
              chatMessages={chatMessages}
              onQualityChange={handleQualityChange}
              onSendMessage={sendChatMessage}
              onStartNow={() => updateSchedule(new Date().toISOString(), 'playing')}
              onOpenSchedule={() => setIsScheduleOpen(true)}
              onOpenChangeMovie={() => setIsChangeMovieOpen(true)}
            />
          </div>
        </div>
      </main>

      {/* Modals */}
      <ChangeMovieModal
        isOpen={isChangeMovieOpen}
        onClose={() => setIsChangeMovieOpen(false)}
        currentMovie={currentMovie}
        onSaveMovie={(movieUpdate) => updateMovie(movieUpdate)}
        showToast={showToast}
      />

      <ScheduleModal
        isOpen={isScheduleOpen}
        onClose={() => setIsScheduleOpen(false)}
        currentSchedule={room?.scheduledTime || null}
        onSaveSchedule={(time, status) => updateSchedule(time, status)}
        showToast={showToast}
      />

      <RoomsModal
        isOpen={isRoomsOpen}
        onClose={() => setIsRoomsOpen(false)}
        currentRoomId={roomId}
        onSelectRoom={(newRoomId) => setRoomId(newRoomId)}
        showToast={showToast}
      />

      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        currentName={user.name}
        currentColor={user.color}
        onSaveProfile={(name, color) => {
          setUser((prev) => ({
            ...prev,
            name,
            avatar: name.slice(0, 2).toUpperCase(),
            color,
          }));
        }}
        showToast={showToast}
      />
    </div>
  );
}
