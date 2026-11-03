import React, { useState, useEffect, useRef } from 'react';
import { AuthUser } from '../types';
import {
  Film,
  Lock,
  User,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  LogOut,
  AlertCircle,
  Radio,
  Eye,
  EyeOff,
} from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser, token: string) => void;
  showToast: (text: string, variant?: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, showToast }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Pending user state
  const [pendingUser, setPendingUser] = useState<{
    userId: string;
    username: string;
    displayName: string;
    message?: string;
  } | null>(() => {
    // Check if there's a stored pending state in sessionStorage
    const saved = sessionStorage.getItem('watchtogether_pending');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  });

  const [isRejected, setIsRejected] = useState(false);
  const [rejectedMessage, setRejectedMessage] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // WebSocket listener for real-time approval when in pending state
  useEffect(() => {
    if (!pendingUser) return;

    let ws: WebSocket | null = null;
    let pollInterval: any = null;
    let isDisposed = false;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'auth:approved' && data.userId === pendingUser.userId) {
            sessionStorage.removeItem('watchtogether_pending');
            showToast('درخواست شما توسط مدیر تایید شد! در حال ورود...', 'success');
            onLoginSuccess(data.user, data.token);
          } else if (data.type === 'auth:rejected' && data.userId === pendingUser.userId) {
            setIsRejected(true);
            setRejectedMessage('درخواست عضویت شما توسط مدیر سیستم رد شد.');
            sessionStorage.removeItem('watchtogether_pending');
          }
        } catch {
          // ignore
        }
      };
    } catch (err) {
      console.warn('WS pending listener failed:', err);
    }

    // Polling fallback every 3 seconds in case socket was momentarily offline
    pollInterval = setInterval(async () => {
      if (isDisposed || isRejected) return;
      try {
        const res = await fetch(`/api/auth/status?userId=${encodeURIComponent(pendingUser.userId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'approved' && data.token && data.user) {
            sessionStorage.removeItem('watchtogether_pending');
            showToast('درخواست شما تایید شد! خوش آمدید.', 'success');
            onLoginSuccess(data.user, data.token);
          } else if (data.status === 'rejected') {
            setIsRejected(true);
            setRejectedMessage('درخواست عضویت شما توسط مدیر سیستم رد شد.');
            sessionStorage.removeItem('watchtogether_pending');
          }
        }
      } catch {
        // network silent
      }
    }, 3000);

    return () => {
      isDisposed = true;
      if (pollInterval) clearInterval(pollInterval);
      if (ws) ws.close();
    };
  }, [pendingUser, isRejected, onLoginSuccess, showToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanUser = username.trim();
    const cleanPass = password.trim();

    if (!cleanUser || !cleanPass) {
      setErrorMessage('لطفاً نام کاربری و رمز عبور را وارد کنید.');
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
          displayName: displayName.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok && !data.status) {
        setErrorMessage(data.error || 'خطا در ارتباط با سرور.');
        setIsLoading(false);
        return;
      }

      if (data.success && data.token && data.user) {
        // Logged in immediately (either Admin or already approved user)
        sessionStorage.removeItem('watchtogether_pending');
        showToast(
          data.user.role === 'admin'
            ? 'ورود به عنوان مدیر سیستم موفقیت‌آمیز بود.'
            : `خوش آمدید ${data.user.displayName}!`,
          'success'
        );
        onLoginSuccess(data.user, data.token);
      } else if (data.status === 'pending') {
        // User created or already pending approval by admin
        const pendingObj = {
          userId: data.userId,
          username: data.username,
          displayName: data.displayName || data.username,
          message: data.message,
        };
        setPendingUser(pendingObj);
        sessionStorage.setItem('watchtogether_pending', JSON.stringify(pendingObj));
        showToast('حساب شما ایجاد شد و در انتظار تایید مدیر سیستم است.', 'info');
      } else if (data.status === 'rejected') {
        setIsRejected(true);
        setRejectedMessage(data.message || 'درخواست ورود شما توسط مدیر رد شده است.');
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
      const res = await fetch(`/api/auth/status?userId=${encodeURIComponent(pendingUser.userId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'approved' && data.token && data.user) {
          sessionStorage.removeItem('watchtogether_pending');
          showToast('درخواست شما تایید شد! در حال انتقال...', 'success');
          onLoginSuccess(data.user, data.token);
          return;
        } else if (data.status === 'rejected') {
          setIsRejected(true);
          setRejectedMessage('درخواست عضویت شما توسط مدیر سیستم رد شد.');
          sessionStorage.removeItem('watchtogether_pending');
          return;
        } else {
          showToast('همچنان در انتظار تایید مدیر سیستم است.', 'info');
        }
      }
    } catch {
      showToast('خطا در بررسی وضعیت.', 'warning');
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleCancelPending = () => {
    setPendingUser(null);
    setIsRejected(false);
    setRejectedMessage(null);
    sessionStorage.removeItem('watchtogether_pending');
  };

  return (
    <div className="min-h-screen bg-[#070913] text-slate-100 flex flex-col justify-center items-center px-4 py-8 relative overflow-hidden font-sans select-none selection:bg-purple-600 selection:text-white" dir="rtl">
      {/* Background Ambient Glows */}
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-purple-600/20 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-900/10 rounded-full blur-[180px] pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-md z-10">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-violet-500 shadow-xl shadow-purple-600/30 mb-3 border border-purple-400/30 animate-pulse">
            <Film className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-purple-300 bg-clip-text text-transparent">
            Watch<span className="text-purple-400">Together</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            سامانه تماشای همزمان فیلم و سریال با همگام‌سازی لحظه‌ای
          </p>
        </div>

        {/* Card Body */}
        <div className="bg-[#0f1325]/90 border border-purple-500/20 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl shadow-black/80 relative">
          {/* Conditional View: 1. Rejected State */}
          {isRejected ? (
            <div className="text-center py-4 flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 shadow-lg shadow-rose-900/30">
                <XCircle className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">درخواست ورود رد شد</h3>
              <p className="text-sm text-slate-300 leading-relaxed mb-6">
                {rejectedMessage || 'مدیر سیستم درخواست عضویت شما را نپذیرفت.'}
              </p>
              <button
                onClick={handleCancelPending}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>ورود با نام کاربری دیگر</span>
              </button>
            </div>
          ) : pendingUser ? (
            /* Conditional View: 2. Pending Approval State */
            <div className="text-center py-2 flex flex-col items-center">
              {/* Pulsing Radar Ring */}
              <div className="relative mb-5 flex items-center justify-center">
                <div className="w-20 h-20 rounded-full bg-purple-600/20 animate-ping absolute opacity-60" />
                <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-xl shadow-purple-600/40 relative z-10 border border-purple-400/50">
                  <Clock className="w-8 h-8 animate-spin duration-1000" />
                </div>
              </div>

              <h3 className="text-lg sm:text-xl font-bold text-white mb-1">
                در انتظار تأیید مدیر سیستم
              </h3>
              <p className="text-xs text-purple-300 font-medium mb-4 flex items-center gap-1.5 bg-purple-950/60 px-3 py-1 rounded-full border border-purple-800/40">
                <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span>اتصال زنده لحظه‌ای (WebSocket Sync) برقرار است</span>
              </p>

              <div className="bg-[#141933] border border-slate-800 rounded-2xl p-4 w-full text-right mb-5 text-xs text-slate-300 space-y-2">
                <div className="flex justify-between items-center text-slate-400">
                  <span>نام کاربری:</span>
                  <strong className="text-slate-100 font-mono text-sm">{pendingUser.username}</strong>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>نام نمایشی:</span>
                  <strong className="text-slate-100">{pendingUser.displayName}</strong>
                </div>
                <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
                  به محض اینکه مدیر سیستم درخواست شما را در پنل ادمین تأیید کند، به طور خودکار به اتاق تماشا منتقل خواهید شد.
                </div>
              </div>

              {/* Action Buttons */}
              <div className="w-full flex flex-col gap-2.5">
                <button
                  onClick={handleManualCheck}
                  disabled={checkingStatus}
                  className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-xl transition-all shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${checkingStatus ? 'animate-spin' : ''}`} />
                  <span>{checkingStatus ? 'در حال بررسی...' : 'بررسی مجدد وضعیت تأیید'}</span>
                </button>

                <button
                  onClick={handleCancelPending}
                  className="w-full py-2 px-4 bg-transparent hover:bg-slate-800/60 text-slate-400 hover:text-slate-200 text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>انصراف و تغییر نام کاربری</span>
                </button>
              </div>
            </div>
          ) : (
            /* Conditional View: 3. Unified Login / Register Form */
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="text-center mb-4">
                <h2 className="text-lg font-bold text-white">ورود و ثبت‌نام یکپارچه</h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  اگر قبلاً تأیید شده‌اید وارد می‌شوید؛ در غیر این صورت حساب جدید ساخته شده و درخواست تأیید برای مدیر ارسال می‌شود.
                </p>
              </div>

              {errorMessage && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Username Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  نام کاربری (Username)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="مثال: sara یا admin"
                    dir="ltr"
                    className="w-full pl-3 pr-10 py-2.5 rounded-xl bg-[#14182f] border border-slate-700/80 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30 text-white placeholder-slate-500 text-sm transition-all"
                    required
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <User className="w-4 h-4" />
                  </div>
                </div>
              </div>

              {/* Password Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  رمز عبور (Password)
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="رمز عبور خود را وارد کنید"
                    dir="ltr"
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[#14182f] border border-slate-700/80 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30 text-white placeholder-slate-500 text-sm transition-all"
                    required
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <Lock className="w-4 h-4" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors p-1"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Display Name (Optional for first-time signups) */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-semibold text-slate-300">
                    نام نمایشی در چت و اتاق
                  </label>
                  <span className="text-[10px] text-slate-500">اختیاری</span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="مثال: سارا محمدی"
                    className="w-full px-3 py-2.5 rounded-xl bg-[#14182f] border border-slate-700/80 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30 text-white placeholder-slate-500 text-sm transition-all"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-purple-600/30 hover:shadow-purple-600/50 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>ورود / ثبت‌نام در سامانه</span>
                    <ArrowRight className="w-4 h-4 rotate-180" />
                  </>
                )}
              </button>

              {/* Admin Note Callout */}
              <div className="mt-4 p-3 rounded-xl bg-purple-950/40 border border-purple-800/40 flex items-start gap-2.5 text-[11px] text-slate-400 leading-relaxed">
                <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-purple-300 block mb-0.5">ورود مدیر سیستم (Admin):</strong>
                  مدیر سیستم می‌تواند با نام کاربری و رمز عبور تعیین شده در فایل <code className="text-purple-300 bg-purple-900/50 px-1 py-0.5 rounded font-mono text-[10px]">.env</code> (پیش‌فرض: <span className="font-mono text-purple-200">admin</span> / <span className="font-mono text-purple-200">admin123</span>) وارد شده و درخواست‌های کاربران را تأیید نماید.
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Footer info */}
        <div className="text-center mt-6 text-xs text-slate-500 flex items-center justify-center gap-2">
          <span>WatchTogether Ultra-low Latency Platform</span>
          <span>•</span>
          <span>امنیت و تأیید هویت یکپارچه</span>
        </div>
      </div>
    </div>
  );
};
