import React, { useState, useEffect, useRef } from 'react';
import { AuthUser, StorageFileItem, StorageStats } from '../types';
import { timeAgo } from '../utils/formatTime';
import {
  Users,
  X,
  Check,
  UserX,
  Clock,
  ShieldCheck,
  RefreshCw,
  Search,
  CheckCircle,
  HardDrive,
  Trash2,
  Sparkles,
  Film,
  Play,
  PlayCircle,
  AlertTriangle,
  FolderOpen,
  ArrowRight,
  Database,
  Sliders,
  CheckCircle2,
  Upload,
  Plus,
} from 'lucide-react';

interface AdminUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
  adminToken: string;
  showToast: (text: string, variant?: string) => void;
  onPendingCountChange?: (count: number) => void;
  onSetRoomMovie?: (videoUrl: string, title: string) => void;
}

export const AdminUsersModal: React.FC<AdminUsersModalProps> = ({
  isOpen,
  onClose,
  adminToken,
  showToast,
  onPendingCountChange,
  onSetRoomMovie,
}) => {
  // Main Navigation: Users vs Storage
  const [mainTab, setMainTab] = useState<'users' | 'storage'>('users');

  // Users State
  const [usersList, setUsersList] = useState<AuthUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [userFilterTab, setUserFilterTab] = useState<'pending' | 'approved'>('pending');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  // Storage State
  const [storageData, setStorageData] = useState<StorageStats | null>(null);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [storageSearchQuery, setStorageSearchQuery] = useState('');
  const [selectedPreviewVideo, setSelectedPreviewVideo] = useState<StorageFileItem | null>(null);
  const [isUpdatingRetention, setIsUpdatingRetention] = useState(false);
  const [isCleaningStorage, setIsCleaningStorage] = useState(false);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch Users
  const fetchUsers = async () => {
    if (!adminToken) return;
    setIsLoadingUsers(true);
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsersList(data.users || []);
        if (onPendingCountChange && typeof data.pendingCount === 'number') {
          onPendingCountChange(data.pendingCount);
        }
      } else {
        showToast('خطا در دریافت لیست کاربران.', 'warning');
      }
    } catch {
      showToast('خطا در اتصال به سرور.', 'warning');
    } finally {
      setIsLoadingUsers(false);
    }
  };

  // Fetch Storage Stats & Files
  const fetchStorage = async () => {
    if (!adminToken) return;
    setIsLoadingStorage(true);
    try {
      const res = await fetch('/api/admin/storage', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        const data: StorageStats = await res.json();
        setStorageData(data);
      } else {
        showToast('خطا در بارگذاری اطلاعات استوریج.', 'warning');
      }
    } catch {
      showToast('خطا در دریافت وضعیت استوریج.', 'warning');
    } finally {
      setIsLoadingStorage(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (mainTab === 'users') {
        fetchUsers();
      } else {
        fetchStorage();
      }
    }
  }, [isOpen, mainTab, adminToken]);

  // Real-time WebSocket listener for new user registrations
  useEffect(() => {
    if (!isOpen) return;

    let ws: WebSocket | null = null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'admin:new_pending_user') {
            showToast(`کاربر جدید "${data.user.displayName}" درخواست ورود دارد!`, 'info');
            fetchUsers();
          } else if (data.type === 'auth:approved' || data.type === 'auth:rejected') {
            fetchUsers();
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }

    return () => {
      if (ws) ws.close();
    };
  }, [isOpen]);

  // User Approval Handlers
  const handleApprove = async (user: AuthUser) => {
    setActionInProgressId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        showToast(`کاربر "${user.displayName}" تأیید شد و اجازه ورود یافت.`, 'success');
        await fetchUsers();
      } else {
        showToast('خطا در تأیید کاربر.', 'warning');
      }
    } catch {
      showToast('خطا در برقراری ارتباط با سرور.', 'warning');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleReject = async (user: AuthUser) => {
    if (!confirm(`آیا از رد درخواست کاربر "${user.displayName}" اطمینان دارید؟`)) return;
    setActionInProgressId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        showToast(`درخواست کاربر "${user.displayName}" رد شد.`, 'info');
        await fetchUsers();
      } else {
        showToast('خطا در رد درخواست کاربر.', 'warning');
      }
    } catch {
      showToast('خطا در ارتباط با سرور.', 'warning');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleDeleteUser = async (user: AuthUser) => {
    if (!confirm(`آیا از حذف کامل حساب "${user.displayName}" اطمینان دارید؟`)) return;
    setActionInProgressId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        showToast(`کاربر "${user.displayName}" با موفقیت حذف شد.`, 'success');
        await fetchUsers();
      } else {
        showToast('خطا در حذف کاربر.', 'warning');
      }
    } catch {
      showToast('خطا در ارتباط با سرور.', 'warning');
    } finally {
      setActionInProgressId(null);
    }
  };

  // Storage Handlers
  const handleUpdateRetention = async (hours: number) => {
    setIsUpdatingRetention(true);
    try {
      const res = await fetch('/api/admin/storage/retention', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ hours }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`مدت ماندگاری به ${hours === 0 ? 'همیشگی' : `${hours} ساعت`} تغییر یافت.`, 'success');
        if (data.cleanedFiles > 0) {
          showToast(`${data.cleanedFiles} فایل منقضی شده حذف و ${data.freedSize} آزاد گردید.`, 'info');
        }
        await fetchStorage();
      } else {
        showToast('خطا در تغییر مدت ماندگاری.', 'warning');
      }
    } catch {
      showToast('خطا در اتصال به سرور.', 'warning');
    } finally {
      setIsUpdatingRetention(false);
    }
  };

  const handleManualCleanup = async () => {
    setIsCleaningStorage(true);
    try {
      const res = await fetch('/api/admin/storage/cleanup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.deletedCount > 0) {
          showToast(`پاکسازی انجام شد: ${data.deletedCount} فایل حذف و ${data.formattedFreedSize} فضا آزاد شد.`, 'success');
        } else {
          showToast('هیچ فایل منقضی شده‌ای برای پاکسازی وجود ندارد.', 'info');
        }
        await fetchStorage();
      } else {
        showToast('خطا در اجرای پاکسازی استوریج.', 'warning');
      }
    } catch {
      showToast('خطا در اتصال به سرور.', 'warning');
    } finally {
      setIsCleaningStorage(false);
    }
  };

  const handleDeleteStorageFile = async (file: StorageFileItem) => {
    if (file.isCurrentlyPlaying) {
      if (!confirm(`این ویدیو در حال حاضر در یکی از اتاق‌ها در حال پخش است! آیا مطمئنید می‌خواهید آن را حذف کنید؟`)) {
        return;
      }
    } else {
      if (!confirm(`آیا از حذف دائم فایل "${file.title}" (${file.formattedSize}) اطمینان دارید؟`)) {
        return;
      }
    }

    try {
      const res = await fetch(`/api/admin/storage/files/${encodeURIComponent(file.filename)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        showToast(`فایل "${file.title}" از سرور حذف گردید.`, 'success');
        if (selectedPreviewVideo?.filename === file.filename) {
          setSelectedPreviewVideo(null);
        }
        await fetchStorage();
      } else {
        showToast('خطا در حذف فایل.', 'warning');
      }
    } catch {
      showToast('خطا در ارتباط با سرور.', 'warning');
    }
  };

  const handleSetAsActiveRoomMovie = (file: StorageFileItem) => {
    if (onSetRoomMovie) {
      const movieTitle = file.title;
      onSetRoomMovie(file.url, movieTitle);
      showToast(`فیلم اتاق به "${movieTitle}" تغییر یافت و برای همه همگام شد.`, 'success');
      onClose();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingVideo(true);
    setUploadProgressText(`در حال آپلود "${file.name}"...`);

    const formData = new FormData();
    formData.append('video', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        showToast(`فیلم "${file.name}" با موفقیت روی سرور ذخیره شد.`, 'success');
        await fetchStorage();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'خطا در آپلود ویدیو.', 'warning');
      }
    } catch {
      showToast('خطا در برقراری ارتباط با سرور هنگام آپلود.', 'warning');
    } finally {
      setIsUploadingVideo(false);
      setUploadProgressText('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (!isOpen) return null;

  const pendingUsers = usersList.filter((u) => u.status === 'pending');
  const approvedUsers = usersList.filter((u) => u.status === 'approved' && u.role !== 'admin');

  const filteredUsers = (userFilterTab === 'pending' ? pendingUsers : approvedUsers).filter(
    (u) =>
      u.username.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
      u.displayName.toLowerCase().includes(userSearchQuery.toLowerCase())
  );

  const filteredStorageFiles = (storageData?.films || []).filter(
    (f) =>
      f.title.toLowerCase().includes(storageSearchQuery.toLowerCase()) ||
      f.filename.toLowerCase().includes(storageSearchQuery.toLowerCase())
  );

  // Storage percentage towards 10GB quota
  const storagePercentage = storageData
    ? Math.min(100, Math.round((storageData.totalBytes / storageData.maxStorageBytes) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in" dir="rtl">
      <div className="bg-[#0e1224] border border-purple-500/30 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#13172e]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center shadow-md">
              <ShieldCheck className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg text-white flex items-center gap-2">
                <span>پنل جامع مدیریت سیستم</span>
                <span className="text-[10px] font-mono bg-purple-950 text-purple-300 border border-purple-700/50 px-2 py-0.5 rounded-full">
                  Admin Dashboard
                </span>
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Top-Level Tabs: Users vs Storage */}
        <div className="px-6 pt-3 pb-0 bg-[#0a0d1a] border-b border-slate-800 flex items-center gap-2">
          <button
            onClick={() => setMainTab('users')}
            className={`px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-bold transition-all border-b-2 flex items-center gap-2 ${
              mainTab === 'users'
                ? 'border-purple-500 text-purple-300 bg-[#141933]/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>مدیریت کاربران و درخواست‌ها</span>
            {pendingUsers.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center animate-pulse">
                {pendingUsers.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setMainTab('storage')}
            className={`px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-bold transition-all border-b-2 flex items-center gap-2 ${
              mainTab === 'storage'
                ? 'border-purple-500 text-purple-300 bg-[#141933]/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>مدیریت استوریج ویدیوها</span>
            {storageData && (
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-mono">
                {storageData.formattedTotalSize}
              </span>
            )}
          </button>
        </div>

        {/* TAB 1: USERS MANAGEMENT */}
        {mainTab === 'users' && (
          <>
            {/* Sub-controls */}
            <div className="p-4 bg-[#0c1022] border-b border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setUserFilterTab('pending')}
                  className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 ${
                    userFilterTab === 'pending'
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                      : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  <span>درخواست‌های در انتظار</span>
                  {pendingUsers.length > 0 && (
                    <span className="w-5 h-5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center animate-pulse">
                      {pendingUsers.length}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setUserFilterTab('approved')}
                  className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 ${
                    userFilterTab === 'approved'
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                      : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>کاربران تأیید شده ({approvedUsers.length})</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-48">
                  <input
                    type="text"
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    placeholder="جستجوی کاربر..."
                    className="w-full pl-3 pr-8 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                  <Search className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                </div>

                <button
                  onClick={fetchUsers}
                  disabled={isLoadingUsers}
                  title="بروزرسانی"
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingUsers ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Users List */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
              {isLoadingUsers && usersList.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-sm flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-purple-400" />
                  <span>در حال بارگذاری کاربران...</span>
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs sm:text-sm flex flex-col items-center justify-center gap-2">
                  <Users className="w-8 h-8 text-slate-600 mb-1" />
                  <span>
                    {userFilterTab === 'pending'
                      ? 'هیچ درخواست جدیدی در انتظار تأیید نیست.'
                      : 'کاربر تأیید شده‌ای یافت نشد.'}
                  </span>
                </div>
              ) : (
                filteredUsers.map((u) => (
                  <div
                    key={u.id}
                    className="bg-[#12162a] hover:bg-[#151a33] border border-slate-800/80 hover:border-purple-500/30 rounded-2xl p-4 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md"
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className="w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-white text-sm shadow-md shrink-0"
                        style={{ backgroundColor: u.color || '#8b5cf6' }}
                      >
                        {u.avatar || u.displayName.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-white text-sm sm:text-base">
                            {u.displayName}
                          </h4>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                            @{u.username}
                          </span>
                          {u.status === 'pending' ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 font-semibold">
                              در انتظار تأیید
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-semibold">
                              تأیید شده
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                          <span>ثبت‌نام:</span>
                          <span className="font-mono text-slate-300">
                            {u.createdAt ? new Date(u.createdAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : 'نامشخص'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      {u.status === 'pending' ? (
                        <>
                          <button
                            onClick={() => handleApprove(u)}
                            disabled={actionInProgressId === u.id}
                            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>تأیید ورود</span>
                          </button>
                          <button
                            onClick={() => handleReject(u)}
                            disabled={actionInProgressId === u.id}
                            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-950/80 border border-slate-700 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <UserX className="w-3.5 h-3.5 text-rose-400" />
                            <span>رد درخواست</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleReject(u)}
                            disabled={actionInProgressId === u.id}
                            title="تعلیق دسترسی"
                            className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-medium transition-colors flex items-center gap-1"
                          >
                            <UserX className="w-3.5 h-3.5" />
                            <span>تعلیق</span>
                          </button>
                          <button
                            onClick={() => handleDeleteUser(u)}
                            disabled={actionInProgressId === u.id}
                            title="حذف کامل کاربر"
                            className="p-2 rounded-xl bg-slate-800/80 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* TAB 2: VIDEO STORAGE MANAGEMENT */}
        {mainTab === 'storage' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
            {/* Storage Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {/* Total Space */}
              <div className="p-4 rounded-2xl bg-[#12162a] border border-slate-800 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                  <span className="flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-purple-400" />
                    <span>فضای مصرف شده سرور</span>
                  </span>
                  <span className="font-mono text-purple-300">{storagePercentage}%</span>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-white mb-2 font-mono">
                  {storageData?.formattedTotalSize || '0 B'}
                  <span className="text-xs text-slate-500 font-normal mr-1.5">از ۱۰ گیگابایت سهمیه</span>
                </div>
                {/* Progress bar */}
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all rounded-full ${
                      storagePercentage > 85
                        ? 'bg-rose-500'
                        : storagePercentage > 60
                        ? 'bg-amber-500'
                        : 'bg-purple-600'
                    }`}
                    style={{ width: `${Math.max(4, storagePercentage)}%` }}
                  />
                </div>
              </div>

              {/* Uploaded Videos Count */}
              <div className="p-4 rounded-2xl bg-[#12162a] border border-slate-800 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                  <span className="flex items-center gap-1.5">
                    <Film className="w-4 h-4 text-indigo-400" />
                    <span>تعداد ویدیوهای ذخیره شده</span>
                  </span>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-white mb-2 font-mono">
                  {storageData?.totalFiles || 0}
                  <span className="text-xs text-slate-400 font-normal mr-1">فایل</span>
                </div>
              </div>

              {/* Auto-Deletion Policy Setting */}
              <div className="p-4 rounded-2xl bg-[#12162a] border border-slate-800 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-emerald-400" />
                    <span>حذف خودکار بعد از آخرین تماشا</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={storageData?.retentionHours ?? 0}
                    onChange={(e) => handleUpdateRetention(Number(e.target.value))}
                    disabled={isUpdatingRetention}
                    className="w-full bg-[#171c35] border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500 font-semibold cursor-pointer"
                  >
                    <option value={0}>بدون حذف خودکار (دائمی - پیش‌فرض)</option>
                    <option value={12}>۱۲ ساعت (پاکسازی خودکار)</option>
                    <option value={24}>۲۴ ساعت (۱ روز)</option>
                    <option value={48}>۴۸ ساعت (۲ روز)</option>
                    <option value={72}>۷۲ ساعت (۳ روز)</option>
                    <option value={168}>۷ روز (۱ هفته)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Quick Actions Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 bg-[#0a0d1a] border border-slate-800/80 rounded-2xl">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/mkv,video/quicktime,video/*"
                onChange={handleFileUpload}
                className="hidden"
              />

              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-64">
                  <input
                    type="text"
                    value={storageSearchQuery}
                    onChange={(e) => setStorageSearchQuery(e.target.value)}
                    placeholder="جستجو در نام فیلم‌های ذخیره شده..."
                    className="w-full pl-3 pr-8 py-1.5 text-xs rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                  <Search className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Direct Upload Button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingVideo}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-600/30 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="آپلود ویدیوی جدید روی سرور"
                >
                  <Upload className={`w-3.5 h-3.5 ${isUploadingVideo ? 'animate-bounce' : ''}`} />
                  <span>{isUploadingVideo ? (uploadProgressText || 'در حال آپلود...') : 'آپلود فیلم جدید'}</span>
                </button>

                {/* Manual Cleanup Button */}
                <button
                  onClick={handleManualCleanup}
                  disabled={isCleaningStorage}
                  className="px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="حذف فوری تمام فایل‌های منقضی شده"
                >
                  <Trash2 className={`w-3.5 h-3.5 ${isCleaningStorage ? 'animate-spin' : ''}`} />
                  <span>پاکسازی منقضی‌شده‌ها</span>
                </button>

                {/* Refresh Storage */}
                <button
                  onClick={fetchStorage}
                  disabled={isLoadingStorage}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  title="بروزرسانی استوریج"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingStorage ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Video Preview Modal (If Selected) */}
            {selectedPreviewVideo && (
              <div className="p-4 rounded-2xl bg-[#141933] border border-purple-500/40 shadow-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PlayCircle className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-bold text-white">
                      پیش‌نمایش: {selectedPreviewVideo.title}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedPreviewVideo(null)}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <video
                  src={selectedPreviewVideo.url}
                  controls
                  className="w-full max-h-56 rounded-xl bg-black shadow-inner"
                />
              </div>
            )}

            {/* Video Files List */}
            <div className="space-y-3">
              {isLoadingStorage && !storageData ? (
                <div className="py-12 text-center text-slate-400 text-sm flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-purple-400" />
                  <span>در حال بررسی دیسک و فایل‌های ویدیویی...</span>
                </div>
              ) : filteredStorageFiles.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs sm:text-sm flex flex-col items-center justify-center gap-3 border border-dashed border-slate-800 rounded-2xl p-8">
                  <FolderOpen className="w-10 h-10 text-slate-600 mb-1" />
                  <span className="font-semibold text-slate-300">هیچ فایل ویدیویی ذخیره شده‌ای روی سرور وجود ندارد.</span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingVideo}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-600/30 transition-all cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>آپلود اولین فیلم</span>
                  </button>
                </div>
              ) : (
                filteredStorageFiles.map((f) => (
                  <div
                    key={f.id}
                    className="p-4 rounded-2xl bg-[#12162a] hover:bg-[#151a33] border border-slate-800/80 hover:border-purple-500/40 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md"
                  >
                    {/* File Meta */}
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-12 h-12 rounded-2xl bg-purple-600/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0 shadow-sm">
                        <Film className="w-6 h-6" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-white text-sm truncate max-w-[240px] sm:max-w-md" title={f.title}>
                            {f.title}
                          </h4>
                          {f.isCurrentlyPlaying ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                              در حال پخش در اتاق
                            </span>
                          ) : f.timeLeftMs && f.timeLeftMs <= 0 ? (
                            <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] font-bold">
                              منقضی شده
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-mono">
                              ذخیره شده
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-3 flex-wrap">
                          <span className="text-slate-200">آخرین تماشا: {timeAgo(f.lastWatchedAt, 'fa')}</span>
                          <span>•</span>
                          <span className="font-mono text-purple-300 font-semibold">{f.formattedSize}</span>
                          <span>•</span>
                          <span>آپلود: {new Date(f.uploadedAt).toLocaleDateString('fa-IR')}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1 text-slate-300">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>ماندگاری: {f.formattedTimeLeft}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      {/* Preview Button */}
                      <button
                        onClick={() => setSelectedPreviewVideo(selectedPreviewVideo?.filename === f.filename ? null : f)}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                        title="پیش‌نمایش ویدیو"
                      >
                        <Play className="w-3 h-3 text-purple-400" />
                        <span>پیش‌نمایش</span>
                      </button>

                      {/* Set as Room Movie */}
                      {onSetRoomMovie && (
                        <button
                          onClick={() => handleSetAsActiveRoomMovie(f)}
                          className="px-3 py-1.5 rounded-xl bg-purple-600/30 hover:bg-purple-600 text-purple-200 hover:text-white border border-purple-500/40 text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer shadow-sm"
                          title="انتخاب این فیلم برای تماشا در اتاق"
                        >
                          <Film className="w-3 h-3" />
                          <span>پخش در اتاق</span>
                        </button>
                      )}

                      {/* Delete File */}
                      <button
                        onClick={() => handleDeleteStorageFile(f)}
                        className="p-2 rounded-xl bg-slate-800/80 hover:bg-rose-950/80 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 transition-colors cursor-pointer"
                        title="حذف فوری فایل از سرور"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="p-4 bg-[#0a0d1a] border-t border-slate-800 text-xs text-slate-400 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
};
