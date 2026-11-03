import React, { useState, useEffect } from 'react';
import { AuthUser } from '../types';
import { Film, Lock, User, Clock, XCircle, RefreshCw, AlertCircle, Eye, EyeOff } from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser, token: string) => void;
  showToast: (text: string, variant?: string) => void;
}

const REMEMBER_KEY = 'watchtogether_login';

interface PendingUser {
  userId: string;
  username: string;
  displayName: string;
  statusToken?: string;
}

function loadRemembered(): { username: string; displayName: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}');
    return { username: saved.username || '', displayName: saved.displayName || '' };
  } catch {
    return { username: '', displayName: '' };
  }
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, showToast }) => {
  const [remembered] = useState(loadRemembered);
  const [username, setUsername] = useState(remembered.username);
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(remembered.displayName);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [pendingUser, setPendingUser] = useState<PendingUser | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('watchtogether_pending') || 'null');
    } catch {
      return null;
    }
  });
  const [isRejected, setIsRejected] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // The display name only matters when signing up, so it is asked for new usernames only.
  const isKnownUsername = remembered.username !== '' && username.trim().toLowerCase() === remembered.username;

  const clearPending = () => {
    sessionStorage.removeItem('watchtogether_pending');
  };

  // Asks the server about the pending account (proven with its status token) and logs in once
  // approved. Returns true when waiting is over (approved, rejected or the waiting state expired).
  const checkPendingStatus = async (p: PendingUser): Promise<boolean> => {
    const res = await fetch(`/api/auth/status?userId=${encodeURIComponent(p.userId)}`, {
      headers: { 'X-Status-Token': p.statusToken || '' },
    });
    if (res.status === 403) {
      clearPending();
      setPendingUser(null);
      setErrorMessage('لطفاً دوباره وارد شوید.');
      return true;
    }
    if (!res.ok) return false;
    const data = await res.json();
    if (data.status === 'approved' && data.token && data.user) {
      clearPending();
      showToast('حساب شما تأیید شد.', 'success');
      onLoginSuccess(data.user, data.token);
      return true;
    }
    if (data.status === 'rejected') {
      clearPending();
      setIsRejected(true);
      return true;
    }
    return false;
  };

  // While waiting for approval: live events over WebSocket, with polling as a fallback.
  useEffect(() => {
    if (!pendingUser) return;
    let disposed = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'auth:watch', userId: pendingUser.userId, statusToken: pendingUser.statusToken }));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.userId !== pendingUser.userId) return;
          if (data.type === 'auth:approved') {
            checkPendingStatus(pendingUser).catch(() => {});
          } else if (data.type === 'auth:rejected') {
            clearPending();
            setIsRejected(true);
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // polling below still works
    }
    const poll = setInterval(() => {
      if (!disposed && !isRejected) checkPendingStatus(pendingUser).catch(() => {});
    }, 3000);
    return () => {
      disposed = true;
      clearInterval(poll);
      ws?.close();
    };
  }, [pendingUser, isRejected]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const cleanUser = username.trim();
    const cleanPass = password.trim();
    if (!cleanUser || !cleanPass) {
      setErrorMessage('نام کاربری و رمز عبور را وارد کنید.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login-or-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanUser,
          password: cleanPass,
          displayName: isKnownUsername ? undefined : displayName.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok && !data.status) {
        setErrorMessage(data.error || 'خطا در ارتباط با سرور.');
        return;
      }

      // Remember who logs in on this device, so the name is typed only once.
      try {
        localStorage.setItem(
          REMEMBER_KEY,
          JSON.stringify({
            username: cleanUser.toLowerCase(),
            displayName: data.user?.displayName || data.displayName || displayName.trim(),
          })
        );
      } catch {
        // storage unavailable
      }

      if (data.success && data.token && data.user) {
        clearPending();
        onLoginSuccess(data.user, data.token);
      } else if (data.status === 'pending') {
        const pending: PendingUser = {
          userId: data.userId,
          username: data.username,
          displayName: data.displayName || data.username,
          statusToken: data.statusToken,
        };
        setPendingUser(pending);
        sessionStorage.setItem('watchtogether_pending', JSON.stringify(pending));
      } else if (data.status === 'rejected') {
        setIsRejected(true);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'خطا در اتصال به سرور.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualCheck = async () => {
    if (!pendingUser) return;
    setCheckingStatus(true);
    try {
      if (!(await checkPendingStatus(pendingUser))) {
        showToast('هنوز تأیید نشده است.', 'info');
      }
    } catch {
      showToast('خطا در بررسی وضعیت.', 'warning');
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleCancel = () => {
    setPendingUser(null);
    setIsRejected(false);
    clearPending();
  };

  const inputClass =
    'w-full py-2.5 rounded-xl bg-[#14182f] border border-slate-700/80 focus:border-purple-500 focus:outline-none text-white placeholder-slate-500 text-sm';

  return (
    <div className="min-h-screen bg-[#070913] text-slate-100 flex items-center justify-center px-4" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 mb-3">
            <Film className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold" dir="ltr">
            Watch<span className="text-purple-400">Together</span>
          </h1>
        </div>

        <div className="bg-[#0f1325] border border-purple-500/20 rounded-3xl p-6">
          {isRejected ? (
            <div className="text-center flex flex-col items-center gap-4">
              <XCircle className="w-10 h-10 text-rose-400" />
              <p className="text-sm text-slate-200">درخواست شما رد شد.</p>
              <button
                onClick={handleCancel}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-sm rounded-xl"
              >
                بازگشت
              </button>
            </div>
          ) : pendingUser ? (
            <div className="text-center flex flex-col items-center gap-4">
              <Clock className="w-10 h-10 text-purple-400 animate-pulse" />
              <div>
                <p className="font-bold">در انتظار تأیید مدیر</p>
                <p className="text-xs text-slate-400 mt-1" dir="ltr">
                  @{pendingUser.username}
                </p>
              </div>
              <button
                onClick={handleManualCheck}
                disabled={checkingStatus}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-sm font-semibold rounded-xl flex items-center justify-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${checkingStatus ? 'animate-spin' : ''}`} />
                بررسی وضعیت
              </button>
              <button onClick={handleCancel} className="text-xs text-slate-400 hover:text-slate-200">
                انصراف
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {errorMessage && (
                <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="relative">
                <User className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="نام کاربری"
                  autoComplete="username"
                  autoFocus={!username}
                  className={`${inputClass} pr-10 pl-3`}
                  required
                />
              </div>

              <div className="relative">
                <Lock className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="رمز عبور"
                  autoComplete="current-password"
                  autoFocus={!!username}
                  className={`${inputClass} pr-10 pl-10`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {!isKnownUsername && (
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="نام نمایشی (اختیاری)"
                  className={`${inputClass} px-3`}
                />
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 font-bold rounded-xl text-sm disabled:opacity-50 flex items-center justify-center"
              >
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'ورود'}
              </button>
              <p className="text-[11px] text-slate-500 text-center">نام کاربری جدید پس از تأیید مدیر فعال می‌شود.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
