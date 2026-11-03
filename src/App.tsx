/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { VideoPlayer } from './components/VideoPlayer';
import { PlayerStatsBar } from './components/PlayerStatsBar';
import { MovieSidebar } from './components/MovieSidebar';
import { ChangeMovieModal } from './components/ChangeMovieModal';
import { ScheduleModal } from './components/ScheduleModal';
import { RoomsModal } from './components/RoomsModal';
import { ProfileModal } from './components/ProfileModal';
import { LoginPage } from './components/LoginPage';
import { HomeScreen } from './components/HomeScreen';
import { AdminUsersModal } from './components/AdminUsersModal';
import { useWatchTogetherSync } from './hooks/useWatchTogetherSync';
import { MessageSquare, Users, Film, Radio, Sparkles, Loader2, Mic } from 'lucide-react';
import { AuthUser } from './types';

export default function App() {
  // Authentication State
  const [authToken, setAuthToken] = useState<string | null>(() => {
    return localStorage.getItem('watchtogether_token');
  });
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isAdminUsersOpen, setIsAdminUsersOpen] = useState(false);

  // User video stream quality preference (defaults to 720p as requested)
  const [userQuality, setUserQuality] = useState('720p');

  // Debounced disconnect banner to prevent flickering during initial handshake
  const [showDisconnectBanner, setShowDisconnectBanner] = useState(false);

  // Toast notification for global UI
  const [appToast, setAppToast] = useState<{ text: string; variant?: string } | null>(null);
  const toastTimeoutRef = React.useRef<any>(null);

  const showToast = useCallback((text: string, variant: string = 'info') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setAppToast({ text, variant });
    toastTimeoutRef.current = setTimeout(() => {
      setAppToast(null);
    }, 3500);
  }, []);

  // Fetch initial pending users count if Admin
  const fetchPendingCount = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.pendingCount === 'number') {
          setPendingCount(data.pendingCount);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Verify stored session on load
  useEffect(() => {
    const token = localStorage.getItem('watchtogether_token');
    if (!token) {
      setIsAuthChecking(false);
      return;
    }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Not authenticated');
      })
      .then((data) => {
        if (data.user) {
          setCurrentUser(data.user);
          setAuthToken(token);
          if (data.user.role === 'admin') {
            fetchPendingCount(token);
          }
        } else {
          throw new Error('Invalid user object');
        }
      })
      .catch(() => {
        localStorage.removeItem('watchtogether_token');
        setCurrentUser(null);
        setAuthToken(null);
      })
      .finally(() => {
        setIsAuthChecking(false);
      });
  }, [fetchPendingCount]);

  // Read room from URL query or default to empty (which displays the Home / Lobby Screen)
  const [roomId, setRoomId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || '';
  });

  // Modals state
  const [isChangeMovieOpen, setIsChangeMovieOpen] = useState(false);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isRoomsOpen, setIsRoomsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // User payload for WebSocket sync
  const syncUser = {
    id: currentUser?.id || 'guest',
    name: currentUser?.displayName || 'User',
    avatar: currentUser?.avatar || 'U',
    color: currentUser?.color || '#8b5cf6',
    quality: userQuality,
    role: currentUser?.role || 'user',
  };

  // WebSocket Sync Hook
  const {
    room,
    participants,
    chatMessages,
    latencyMs,
    isConnected,
    videoRef,
    toastNotification: syncToast,
    isMicActive,
    isPushToTalkActive,
    isLocalSpeaking,
    isOpenMic,
    isVoiceBlocked,
    speakingUserIds,
    locallyMutedUserIds,
    toggleMic,
    toggleOpenMic,
    resumeVoicePlayback,
    toggleMuteUser,
    sendVideoAction,
    sendChatMessage,
    changeQuality,
    updateMovie,
    updateSchedule,
    showToast: showSyncToast,
  } = useWatchTogetherSync({
    roomId,
    user: syncUser,
    onNewPendingUser: useCallback((_newUser: any) => {
      setPendingCount((prev) => prev + 1);
    }, []),
  });

  // Only display disconnect banner if disconnected for more than 1.5s (eliminates flicker)
  useEffect(() => {
    if (!isConnected) {
      const timer = setTimeout(() => setShowDisconnectBanner(true), 1500);
      return () => clearTimeout(timer);
    } else {
      setShowDisconnectBanner(false);
    }
  }, [isConnected]);

  // Keep URL updated when room changes
  useEffect(() => {
    const url = new URL(window.location.href);
    if (roomId) {
      if (url.searchParams.get('room') !== roomId) {
        url.searchParams.set('room', roomId);
        window.history.replaceState({}, '', url.toString());
      }
    } else {
      if (url.searchParams.has('room')) {
        url.searchParams.delete('room');
        const cleanPath = url.pathname + (url.search ? url.search : '') + url.hash;
        window.history.replaceState({}, '', cleanPath);
      }
    }
  }, [roomId]);

  // Handle successful login
  const handleLoginSuccess = (user: AuthUser, token: string) => {
    localStorage.setItem('watchtogether_token', token);
    setAuthToken(token);
    setCurrentUser(user);
    if (user.role === 'admin') {
      fetchPendingCount(token);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    if (authToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      } catch {
        // silent
      }
    }
    localStorage.removeItem('watchtogether_token');
    sessionStorage.removeItem('watchtogether_pending');
    setAuthToken(null);
    setCurrentUser(null);
    showToast('شما با موفقیت از حساب کاربری خارج شدید.', 'info');
  };

  // Handle user quality change
  const handleQualityChange = (newQuality: string) => {
    setUserQuality(newQuality);
    changeQuality(newQuality);
    showToast(`کیفیت ویدیو روی ${newQuality} تنظیم شد.`, 'info');
  };

  // Active toast (either from sync or from app)
  const activeToast = appToast || syncToast;

  // Active movie for current room (null if room is newly created and no movie has been chosen yet)
  const currentMovie = room?.movie || null;

  // 1. Initial Auth Loading Screen
  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-[#070913] text-slate-100 flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 animate-pulse">
          <div className="w-12 h-12 rounded-2xl bg-purple-600/30 border border-purple-500/50 flex items-center justify-center text-purple-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
          <span className="text-sm font-semibold text-slate-300">در حال بررسی احراز هویت...</span>
        </div>
      </div>
    );
  }

  // 2. Login & Registration Screen (If not authenticated)
  if (!currentUser) {
    return (
      <>
        {activeToast && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50">
            <div
              className={`px-4 py-2 rounded-xl backdrop-blur-md shadow-2xl border text-xs sm:text-sm font-semibold flex items-center gap-2 ${
                activeToast.variant === 'success'
                  ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300'
                  : activeToast.variant === 'warning'
                  ? 'bg-amber-950/90 border-amber-500/50 text-amber-300'
                  : 'bg-[#151930]/95 border-purple-500/40 text-purple-200'
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0 text-purple-400" />
              <span>{activeToast.text}</span>
            </div>
          </div>
        )}
        <LoginPage onLoginSuccess={handleLoginSuccess} showToast={showToast} />
      </>
    );
  }

  // 3. Home / Lobby Screen (When authenticated, but no specific room is selected)
  if (!roomId) {
    return (
      <>
        {activeToast && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-bounce duration-300">
            <div
              className={`px-4 py-2 rounded-xl backdrop-blur-md shadow-2xl border text-xs sm:text-sm font-semibold flex items-center gap-2 ${
                activeToast.variant === 'success'
                  ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300'
                  : activeToast.variant === 'warning'
                  ? 'bg-amber-950/90 border-amber-500/50 text-amber-300'
                  : 'bg-[#151930]/95 border-purple-500/40 text-purple-200 shadow-purple-900/30'
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0 text-purple-400" />
              <span>{activeToast.text}</span>
            </div>
          </div>
        )}

        <HomeScreen
          currentUser={currentUser}
          onJoinRoom={(newRoomId) => {
            setRoomId(newRoomId);
            showToast(`در حال پیوستن به اتاق «${newRoomId}»...`, 'info');
          }}
          onLogout={handleLogout}
          onOpenAdminUsers={() => setIsAdminUsersOpen(true)}
          pendingUsersCount={pendingCount}
          showToast={showToast}
        />

        {/* Admin User Management Modal (if opened from Home) */}
        {currentUser.role === 'admin' && (
          <AdminUsersModal
            isOpen={isAdminUsersOpen}
            onClose={() => setIsAdminUsersOpen(false)}
            adminToken={authToken || ''}
            showToast={showToast}
            onPendingCountChange={setPendingCount}
          />
        )}
      </>
    );
  }

  // 4. Authenticated Party Room Screen (Playing & Chatting)
  return (
    <div className="min-h-screen bg-[#0a0d18] text-slate-100 flex flex-col font-sans selection:bg-purple-600 selection:text-white">
      {/* Toast Notification Banner */}
      {activeToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 animate-bounce duration-300">
          <div
            className={`px-4 py-2 rounded-xl backdrop-blur-md shadow-2xl border text-xs sm:text-sm font-semibold flex items-center gap-2 ${
              activeToast.variant === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300'
                : activeToast.variant === 'warning'
                ? 'bg-amber-950/90 border-amber-500/50 text-amber-300'
                : 'bg-[#151930]/95 border-purple-500/40 text-purple-200 shadow-purple-900/30'
            }`}
          >
            <Sparkles className="w-4 h-4 shrink-0 text-purple-400" />
            <span>{activeToast.text}</span>
          </div>
        </div>
      )}

      {/* Top Navigation */}
      <Navbar
        roomName={room?.name || 'Movie Night'}
        roomId={roomId}
        userName={currentUser.displayName}
        userAvatar={currentUser.avatar}
        userRole={currentUser.role}
        pendingUsersCount={pendingCount}
        onOpenRooms={() => setIsRoomsOpen(true)}
        onOpenChangeMovie={() => setIsChangeMovieOpen(true)}
        onOpenSchedule={() => setIsScheduleOpen(true)}
        onOpenAdminUsers={() => setIsAdminUsersOpen(true)}
        onEditProfile={() => setIsProfileOpen(true)}
        onLogout={handleLogout}
        onLeaveRoom={() => {
          setRoomId('');
          showToast('به صفحه اصلی بازگشتید.', 'info');
        }}
        showToast={showToast}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col gap-6">
        {/* Connection status banner if reconnecting (shown after grace period to prevent flickering) */}
        {showDisconnectBanner && (
          <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2 flex items-center justify-between text-xs text-amber-300">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>Reconnecting...</span>
            </div>
          </div>
        )}

        {/* Responsive Layout: Player on Left + Details/Chat Sidebar on Right */}
        <div className="flex flex-col lg:flex-row gap-5 lg:gap-6 items-start">
          {/* Left Column: Player & Stats */}
          <div className="flex-1 w-full min-w-0 flex flex-col">
            <VideoPlayer
              videoRef={videoRef}
              videoUrl={currentMovie?.videoUrl || ''}
              posterUrl={currentMovie?.posterUrl || ''}
              title={currentMovie?.title || ''}
              isPlaying={room?.isPlaying || false}
              currentTime={room?.currentTime || 0}
              duration={currentMovie?.duration || 0}
              latencyMs={latencyMs}
              onPlayAction={sendVideoAction}
              onSaveMovie={updateMovie}
              onOpenChangeMovie={() => setIsChangeMovieOpen(true)}
              showToast={showSyncToast}
            />

            {/* Bottom 3 Cards + Audio Visualizer (Desktop view) */}
            <div className="hidden sm:block">
              <PlayerStatsBar
                viewerCount={participants.filter((p) => p.online).length || 1}
                latencyMs={latencyMs}
                isAutoSyncActive={true}
                isPlaying={room?.isPlaying || false}
              />
            </div>

            {/* Quick actions */}
            <div className="mt-4 flex items-center justify-end gap-2">
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setIsChangeMovieOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                >
                  تغییر فیلم یا لینک
                </button>
                <button
                  onClick={() => setIsScheduleOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 text-xs font-medium border border-purple-500/40 transition-colors cursor-pointer"
                >
                  زمان‌بندی / شروع یهویی
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Movie Info, Participants, Quality & Live Chat */}
          <div className="w-full lg:w-auto block">
            <MovieSidebar
              movie={
                currentMovie || {
                  title: 'در انتظار انتخاب فیلم',
                  year: new Date().getFullYear().toString(),
                  genre: 'هنوز فیلمی انتخاب نشده',
                  tagline: '',
                  posterUrl: '',
                  videoUrl: '',
                  duration: 0,
                }
              }
              scheduledTime={room?.scheduledTime || null}
              status={room?.status || 'playing'}
              participants={participants}
              currentUserId={syncUser.id}
              selectedQuality={userQuality}
              chatMessages={chatMessages}
              isMicActive={isMicActive}
              isPushToTalkActive={isPushToTalkActive}
              isLocalSpeaking={isLocalSpeaking}
              isOpenMic={isOpenMic}
              isVoiceBlocked={isVoiceBlocked}
              speakingUserIds={speakingUserIds}
              locallyMutedUserIds={locallyMutedUserIds}
              onToggleMic={toggleMic}
              onToggleOpenMic={toggleOpenMic}
              onResumeVoice={resumeVoicePlayback}
              onToggleMuteUser={toggleMuteUser}
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
        currentMovie={
          currentMovie || {
            title: '',
            year: new Date().getFullYear().toString(),
            genre: '',
            tagline: '',
            posterUrl: '',
            videoUrl: '',
            duration: 0,
          }
        }
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
        currentName={currentUser.displayName}
        currentColor={currentUser.color}
        username={currentUser.username}
        role={currentUser.role}
        onSaveProfile={(name, color) => {
          setCurrentUser((prev: AuthUser | null) => (prev ? { ...prev, displayName: name, color } : null));
        }}
        onLogout={handleLogout}
        showToast={showToast}
      />

      {/* Admin User Management Modal */}
      {currentUser.role === 'admin' && (
        <AdminUsersModal
          isOpen={isAdminUsersOpen}
          onClose={() => setIsAdminUsersOpen(false)}
          adminToken={authToken || ''}
          showToast={showToast}
          onPendingCountChange={setPendingCount}
          onSetRoomMovie={(videoUrl, title) => {
            updateMovie({
              title,
              videoUrl,
              posterUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=800&auto=format&fit=crop',
            });
            showToast(`فیلم اتاق به "${title}" تغییر کرد.`, 'success');
          }}
        />
      )}

      {/* Floating Push-To-Talk (Hold M) Active Indicator */}
      {isPushToTalkActive && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all">
          <div className="px-5 py-2.5 rounded-2xl bg-emerald-950/95 border-2 border-emerald-400 text-emerald-200 shadow-2xl shadow-emerald-500/40 backdrop-blur-md flex items-center gap-3 font-semibold text-xs sm:text-sm">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <Mic className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span>در حال صحبت... (کلید M را رها کنید تا قطع شود)</span>
            <div className="flex items-center gap-1 pr-1">
              <span className="w-1 h-3 rounded-full bg-emerald-400 animate-bounce" />
              <span className="w-1 h-5 rounded-full bg-emerald-400 animate-bounce delay-75" />
              <span className="w-1 h-2 rounded-full bg-emerald-400 animate-bounce delay-150" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
