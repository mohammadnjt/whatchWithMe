/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { VideoPlayer } from './components/VideoPlayer';
import { MovieSidebar } from './components/MovieSidebar';
import { ChangeMovieModal } from './components/ChangeMovieModal';
import { ScheduleModal } from './components/ScheduleModal';
import { RoomsModal } from './components/RoomsModal';
import { ProfileModal } from './components/ProfileModal';
import { LoginPage } from './components/LoginPage';
import { HomeScreen } from './components/HomeScreen';
import { AdminUsersModal } from './components/AdminUsersModal';
import { useWatchTogetherSync } from './hooks/useWatchTogetherSync';
import { Loader2, Mic } from 'lucide-react';
import { AuthUser } from './types';

type ToastState = { text: string; variant?: string } | null;

const Toast: React.FC<{ toast: ToastState }> = ({ toast }) =>
  toast ? (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] pointer-events-none" dir="rtl">
      <div
        className={`px-4 py-2 rounded-xl shadow-2xl border text-xs sm:text-sm font-semibold ${
          toast.variant === 'success'
            ? 'bg-emerald-950/95 border-emerald-500/50 text-emerald-300'
            : toast.variant === 'warning'
            ? 'bg-amber-950/95 border-amber-500/50 text-amber-300'
            : 'bg-[#151930]/95 border-purple-500/40 text-purple-200'
        }`}
      >
        {toast.text}
      </div>
    </div>
  ) : null;

// Display name and color edits are kept per user on this device.
const profileKey = (userId: string) => `watchtogether_profile:${userId}`;

function withSavedProfile(user: AuthUser): AuthUser {
  try {
    const saved = JSON.parse(localStorage.getItem(profileKey(user.id)) || 'null');
    if (saved?.displayName) return { ...user, displayName: saved.displayName, color: saved.color || user.color };
  } catch {
    // ignore
  }
  return user;
}

export default function App() {
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('watchtogether_token'));
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [showDisconnectBanner, setShowDisconnectBanner] = useState(false);

  const [appToast, setAppToast] = useState<ToastState>(null);
  const toastTimeoutRef = React.useRef<any>(null);
  const showToast = useCallback((text: string, variant: string = 'info') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setAppToast({ text, variant });
    toastTimeoutRef.current = setTimeout(() => setAppToast(null), 3000);
  }, []);

  const fetchPendingCount = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.pendingCount === 'number') setPendingCount(data.pendingCount);
      }
    } catch {
      // ignore
    }
  }, []);

  // Restore the session on load
  useEffect(() => {
    const token = localStorage.getItem('watchtogether_token');
    if (!token) {
      setIsAuthChecking(false);
      return;
    }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (!data.user) throw new Error();
        setCurrentUser(withSavedProfile(data.user));
        setAuthToken(token);
        if (data.user.role === 'admin') fetchPendingCount(token);
      })
      .catch(() => {
        localStorage.removeItem('watchtogether_token');
        setCurrentUser(null);
        setAuthToken(null);
      })
      .finally(() => setIsAuthChecking(false));
  }, [fetchPendingCount]);

  const [roomId, setRoomId] = useState<string>(() => new URLSearchParams(window.location.search).get('room') || '');

  const [isChangeMovieOpen, setIsChangeMovieOpen] = useState(false);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isRoomsOpen, setIsRoomsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAdminUsersOpen, setIsAdminUsersOpen] = useState(false);

  const syncUser = {
    id: currentUser?.id || 'guest',
    name: currentUser?.displayName || 'User',
    avatar: currentUser?.avatar || 'U',
    color: currentUser?.color || '#8b5cf6',
    quality: '',
    role: currentUser?.role || 'user',
  };

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
    speakingUserIds,
    locallyMutedUserIds,
    toggleMic,
    toggleMuteUser,
    sendVideoAction,
    sendChatMessage,
    updateMovie,
    updateSchedule,
    showToast: showSyncToast,
  } = useWatchTogetherSync({
    roomId,
    user: syncUser,
    onNewPendingUser: useCallback(() => setPendingCount((prev) => prev + 1), []),
  });

  // Show the reconnect banner only after 1.5s offline, to avoid flicker
  useEffect(() => {
    if (isConnected) {
      setShowDisconnectBanner(false);
      return;
    }
    const timer = setTimeout(() => setShowDisconnectBanner(true), 1500);
    return () => clearTimeout(timer);
  }, [isConnected]);

  // Keep ?room= in the URL in sync
  useEffect(() => {
    const url = new URL(window.location.href);
    if (roomId) url.searchParams.set('room', roomId);
    else url.searchParams.delete('room');
    if (url.toString() !== window.location.href) window.history.replaceState({}, '', url.toString());
  }, [roomId]);

  const handleLoginSuccess = (user: AuthUser, token: string) => {
    localStorage.setItem('watchtogether_token', token);
    setAuthToken(token);
    setCurrentUser(withSavedProfile(user));
    if (user.role === 'admin') fetchPendingCount(token);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
    } catch {
      // ignore
    }
    localStorage.removeItem('watchtogether_token');
    sessionStorage.removeItem('watchtogether_pending');
    setAuthToken(null);
    setCurrentUser(null);
  };

  const activeToast = appToast || syncToast;
  const currentMovie = room?.movie || null;

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-[#070913] flex items-center justify-center">
        <Loader2 className="w-7 h-7 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <Toast toast={activeToast} />
        <LoginPage onLoginSuccess={handleLoginSuccess} showToast={showToast} />
      </>
    );
  }

  const adminModal = currentUser.role === 'admin' && (
    <AdminUsersModal
      isOpen={isAdminUsersOpen}
      onClose={() => setIsAdminUsersOpen(false)}
      adminToken={authToken || ''}
      showToast={showToast}
      onPendingCountChange={setPendingCount}
      onSetRoomMovie={
        roomId
          ? (videoUrl, title) => {
              updateMovie({ title, videoUrl, posterUrl: '' });
            }
          : undefined
      }
    />
  );

  if (!roomId) {
    return (
      <>
        <Toast toast={activeToast} />
        <HomeScreen
          currentUser={currentUser}
          onJoinRoom={setRoomId}
          onLogout={handleLogout}
          onOpenAdminUsers={() => setIsAdminUsersOpen(true)}
          pendingUsersCount={pendingCount}
          showToast={showToast}
        />
        {adminModal}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d18] text-slate-100 flex flex-col font-sans" dir="rtl">
      <Toast toast={activeToast} />

      <Navbar
        roomName={room?.name || roomId}
        roomId={roomId}
        userName={currentUser.displayName}
        userAvatar={currentUser.avatar}
        userColor={currentUser.color}
        userRole={currentUser.role}
        pendingUsersCount={pendingCount}
        onOpenRooms={() => setIsRoomsOpen(true)}
        onOpenChangeMovie={() => setIsChangeMovieOpen(true)}
        onOpenSchedule={() => setIsScheduleOpen(true)}
        onOpenAdminUsers={() => setIsAdminUsersOpen(true)}
        onEditProfile={() => setIsProfileOpen(true)}
        onLogout={handleLogout}
        onLeaveRoom={() => setRoomId('')}
        showToast={showToast}
      />

      <main className="flex-1 max-w-[1720px] w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col gap-4">
        {showDisconnectBanner && (
          <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2 text-xs text-amber-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            در حال اتصال مجدد…
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-5 items-start">
          <div className="flex-1 w-full min-w-0">
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
          </div>

          <MovieSidebar
            movie={currentMovie}
            scheduledTime={room?.scheduledTime || null}
            status={room?.status || 'playing'}
            participants={participants}
            currentUserId={currentUser.id}
            chatMessages={chatMessages}
            isMicActive={isMicActive}
            isPushToTalkActive={isPushToTalkActive}
            isLocalSpeaking={isLocalSpeaking}
            speakingUserIds={speakingUserIds}
            locallyMutedUserIds={locallyMutedUserIds}
            onToggleMic={toggleMic}
            onToggleMuteUser={toggleMuteUser}
            onSendMessage={sendChatMessage}
            onStartNow={() => updateSchedule(new Date().toISOString(), 'playing')}
            onOpenChangeMovie={() => setIsChangeMovieOpen(true)}
          />
        </div>
      </main>

      <ChangeMovieModal
        isOpen={isChangeMovieOpen}
        onClose={() => setIsChangeMovieOpen(false)}
        currentMovie={currentMovie || { title: '', videoUrl: '' }}
        onSaveMovie={updateMovie}
        showToast={showToast}
      />

      <ScheduleModal
        isOpen={isScheduleOpen}
        onClose={() => setIsScheduleOpen(false)}
        currentSchedule={room?.scheduledTime || null}
        onSaveSchedule={updateSchedule}
        showToast={showToast}
      />

      <RoomsModal
        isOpen={isRoomsOpen}
        onClose={() => setIsRoomsOpen(false)}
        currentRoomId={roomId}
        onSelectRoom={setRoomId}
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
          try {
            localStorage.setItem(profileKey(currentUser.id), JSON.stringify({ displayName: name, color }));
          } catch {
            // ignore
          }
          setCurrentUser((prev) => (prev ? { ...prev, displayName: name, color } : null));
        }}
        onLogout={handleLogout}
        showToast={showToast}
      />

      {adminModal}

      {isPushToTalkActive && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="px-4 py-2 rounded-2xl bg-emerald-950/95 border-2 border-emerald-400 text-emerald-200 flex items-center gap-2 font-semibold text-sm">
            <Mic className="w-4 h-4 text-emerald-400 animate-pulse" />
            در حال صحبت…
          </div>
        </div>
      )}
    </div>
  );
}
