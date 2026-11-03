import React, { useState, useEffect } from 'react';
import { AuthUser, FilmItem, StorageStats } from '../types';
import { Users, X, Check, UserX, RefreshCw, Search, Trash2, Film, Upload, HardDrive, Play, Loader2 } from 'lucide-react';
import { timeAgo } from '../utils/formatTime';
import { uploadVideo, isVideoFile } from '../utils/upload';

interface AdminUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
  adminToken: string;
  showToast: (text: string, variant?: string) => void;
  onPendingCountChange?: (count: number) => void;
  onSetRoomMovie?: (videoUrl: string, title: string) => void;
}

const RETENTION_OPTIONS: [number, string][] = [
  [0, 'هرگز'],
  [24, '۱ روز'],
  [72, '۳ روز'],
  [168, '۷ روز'],
  [720, '۳۰ روز'],
];

export const AdminUsersModal: React.FC<AdminUsersModalProps> = ({
  isOpen,
  onClose,
  adminToken,
  showToast,
  onPendingCountChange,
  onSetRoomMovie,
}) => {
  const [tab, setTab] = useState<'users' | 'films'>('users');
  const [query, setQuery] = useState('');

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [userFilter, setUserFilter] = useState<'pending' | 'approved'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const authHeaders = { Authorization: `Bearer ${adminToken}` };

  const api = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body ? { ...authHeaders, 'Content-Type': 'application/json' } : authHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'خطا در ارتباط با سرور.');
    return data;
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await api('GET', '/api/admin/users');
      setUsers(data.users || []);
      if (typeof data.pendingCount === 'number') onPendingCountChange?.(data.pendingCount);
    } catch (err: any) {
      showToast(err.message, 'warning');
    } finally {
      setLoading(false);
    }
  };

  const fetchStorage = async () => {
    setLoading(true);
    try {
      setStorage(await api('GET', '/api/admin/storage'));
    } catch (err: any) {
      showToast(err.message, 'warning');
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => (tab === 'users' ? fetchUsers() : fetchStorage());

  useEffect(() => {
    if (isOpen) refresh();
  }, [isOpen, tab, adminToken]);

  // New sign-ups and approvals show up live.
  useEffect(() => {
    if (!isOpen) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (['admin:new_pending_user', 'auth:approved', 'auth:rejected'].includes(data.type)) fetchUsers();
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, [isOpen]);

  const userAction = async (user: AuthUser, action: 'approve' | 'reject' | 'delete') => {
    if (action === 'reject' && !confirm(`دسترسی «${user.displayName}» قطع شود؟`)) return;
    if (action === 'delete' && !confirm(`حساب «${user.displayName}» حذف شود؟`)) return;
    setBusyId(user.id);
    try {
      const url = `/api/admin/users/${encodeURIComponent(user.id)}`;
      await (action === 'delete' ? api('DELETE', url) : api('POST', `${url}/${action}`));
      await fetchUsers();
    } catch (err: any) {
      showToast(err.message, 'warning');
    } finally {
      setBusyId(null);
    }
  };

  const setRetention = async (hours: number) => {
    try {
      const data = await api('POST', '/api/admin/storage/retention', { hours });
      if (data.cleanedFiles > 0) showToast(`${data.cleanedFiles} فیلم حذف شد (${data.freedSize}).`, 'info');
      await fetchStorage();
    } catch (err: any) {
      showToast(err.message, 'warning');
    }
  };

  const deleteFilm = async (film: FilmItem) => {
    const warning = film.isCurrentlyPlaying ? ' (الان در یک اتاق پخش می‌شود)' : '';
    if (!confirm(`«${film.title}» حذف شود؟${warning}`)) return;
    try {
      await api('DELETE', `/api/admin/storage/files/${encodeURIComponent(film.filename)}`);
      await fetchStorage();
    } catch (err: any) {
      showToast(err.message, 'warning');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isVideoFile(file)) {
      showToast('فایل ویدیویی انتخاب کنید.', 'warning');
      return;
    }
    setUploadProgress(0);
    try {
      await uploadVideo(file, setUploadProgress);
      await fetchStorage();
    } catch (err: any) {
      showToast(err.message, 'warning');
    } finally {
      setUploadProgress(null);
    }
  };

  if (!isOpen) return null;

  const q = query.trim().toLowerCase();
  const pending = users.filter((u) => u.status === 'pending');
  const approved = users.filter((u) => u.status === 'approved' && u.role !== 'admin');
  const shownUsers = (userFilter === 'pending' ? pending : approved).filter(
    (u) => !q || u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)
  );
  const shownFilms = (storage?.films || []).filter((f) => !q || f.title.toLowerCase().includes(q));

  const tabBtn = (id: 'users' | 'films', label: string, icon: React.ReactNode, badge?: number) => (
    <button
      onClick={() => setTab(id)}
      className={`px-3 py-2.5 text-sm font-bold border-b-2 flex items-center gap-1.5 ${
        tab === id ? 'border-purple-500 text-purple-300' : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >
      {icon}
      {label}
      {!!badge && <span className="px-1.5 rounded-full bg-rose-500 text-white text-[10px]">{badge}</span>}
    </button>
  );
  const row = 'bg-[#12162a] border border-slate-800/80 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3';
  const smallBtn = 'px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80" dir="rtl" onClick={onClose}>
      <div
        className="bg-[#0e1224] border border-purple-500/30 rounded-3xl w-full max-w-3xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-3 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center">
            {tabBtn('users', 'کاربران', <Users className="w-4 h-4" />, pending.length)}
            {tabBtn('films', 'فیلم‌ها', <HardDrive className="w-4 h-4" />)}
          </div>
          <div className="flex items-center gap-1 pb-2">
            <button onClick={refresh} disabled={loading} title="بروزرسانی" className="p-2 rounded-lg text-slate-400 hover:text-white">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-slate-800/80 flex flex-wrap items-center gap-2 text-xs">
          {tab === 'users' ? (
            <>
              {(['pending', 'approved'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setUserFilter(f)}
                  className={`px-3 py-1.5 rounded-xl font-semibold ${userFilter === f ? 'bg-purple-600 text-white' : 'bg-slate-800/60 text-slate-400'}`}
                >
                  {f === 'pending' ? `در انتظار (${pending.length})` : `تأییدشده (${approved.length})`}
                </button>
              ))}
            </>
          ) : (
            <>
              <span className="text-slate-300">
                {(storage?.films.length || 0).toLocaleString('fa-IR')} فیلم · {storage?.formattedTotalSize || '0 B'}
              </span>
              <label className="flex items-center gap-1.5 text-slate-400">
                حذف خودکار اگر تماشا نشد:
                <select
                  value={storage?.retentionHours ?? 0}
                  onChange={(e) => setRetention(Number(e.target.value))}
                  className="bg-[#171c35] border border-slate-700 rounded-lg px-2 py-1 text-white"
                >
                  {RETENTION_OPTIONS.map(([h, label]) => (
                    <option key={h} value={h}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${smallBtn} bg-purple-600 hover:bg-purple-500 text-white cursor-pointer`}>
                <input type="file" accept="video/*,.mkv" onChange={handleUpload} disabled={uploadProgress !== null} className="hidden" />
                {uploadProgress === null ? <Upload className="w-3.5 h-3.5" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {uploadProgress === null ? 'آپلود' : `${uploadProgress}%`}
              </label>
            </>
          )}
          <div className="relative mr-auto w-40">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو"
              className="w-full pr-8 pl-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
            <Search className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {tab === 'users' &&
            (shownUsers.length === 0 ? (
              <p className="py-10 text-center text-slate-500 text-sm">کاربری نیست.</p>
            ) : (
              shownUsers.map((u) => (
                <div key={u.id} className={row}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-white text-sm shrink-0"
                      style={{ backgroundColor: u.color || '#8b5cf6' }}
                    >
                      {u.avatar || u.displayName.slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-white text-sm truncate">{u.displayName}</div>
                      <div className="text-[11px] text-slate-400">
                        <span dir="ltr">@{u.username}</span> · {timeAgo(u.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {u.status === 'pending' ? (
                      <>
                        <button onClick={() => userAction(u, 'approve')} disabled={busyId === u.id} className={`${smallBtn} bg-emerald-600 hover:bg-emerald-500 text-white`}>
                          <Check className="w-3.5 h-3.5" />
                          تأیید
                        </button>
                        <button onClick={() => userAction(u, 'reject')} disabled={busyId === u.id} className={`${smallBtn} bg-slate-800 hover:bg-rose-950/80 text-slate-300`}>
                          <UserX className="w-3.5 h-3.5 text-rose-400" />
                          رد
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => userAction(u, 'reject')} disabled={busyId === u.id} className={`${smallBtn} bg-amber-500/10 text-amber-300`}>
                          <UserX className="w-3.5 h-3.5" />
                          تعلیق
                        </button>
                        <button onClick={() => userAction(u, 'delete')} disabled={busyId === u.id} title="حذف" className="p-2 rounded-xl text-slate-400 hover:text-rose-300 hover:bg-rose-900/30">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            ))}

          {tab === 'films' &&
            (shownFilms.length === 0 ? (
              <p className="py-10 text-center text-slate-500 text-sm">فیلمی روی سرور نیست.</p>
            ) : (
              shownFilms.map((f) => (
                <div key={f.id} className={row}>
                  <div className="flex items-center gap-3 min-w-0">
                    <Film className="w-6 h-6 text-purple-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm truncate" title={f.title}>
                          {f.title}
                        </span>
                        {f.isCurrentlyPlaying && (
                          <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold shrink-0">در حال پخش</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        آخرین تماشا: <span className="text-slate-200">{timeAgo(f.lastWatchedAt)}</span> · {f.formattedSize} · آپلود{' '}
                        {timeAgo(f.uploadedAt)}
                        {f.uploadedBy && ` توسط ${f.uploadedBy}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {onSetRoomMovie && (
                      <button
                        onClick={() => {
                          onSetRoomMovie(f.url, f.title);
                          onClose();
                        }}
                        className={`${smallBtn} bg-purple-600/30 hover:bg-purple-600 text-purple-100`}
                      >
                        <Play className="w-3 h-3" />
                        پخش در اتاق
                      </button>
                    )}
                    <button onClick={() => deleteFilm(f)} title="حذف" className="p-2 rounded-xl text-slate-400 hover:text-rose-300 hover:bg-rose-900/30">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            ))}
        </div>
      </div>
    </div>
  );
};
