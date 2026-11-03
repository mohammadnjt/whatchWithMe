import React, { useEffect, useState } from 'react';
import { X, Upload, Link2, Film, Loader2, HardDrive } from 'lucide-react';
import { FilmItem, MovieInfo } from '../types';
import { fetchFilms, isVideoFile, uploadVideo } from '../utils/upload';
import { timeAgo } from '../utils/formatTime';

interface ChangeMovieModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMovie: MovieInfo;
  onSaveMovie: (movie: Partial<MovieInfo>) => void;
  showToast: (text: string, variant?: string) => void;
}

type Tab = 'url' | 'upload' | 'films';

export const ChangeMovieModal: React.FC<ChangeMovieModalProps> = ({ isOpen, onClose, onSaveMovie, showToast }) => {
  const [tab, setTab] = useState<Tab>('url');
  const [videoUrl, setVideoUrl] = useState('');
  const [title, setTitle] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [films, setFilms] = useState<FilmItem[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (isOpen && tab === 'films') {
      setFilms(null);
      fetchFilms().then(setFilms).catch(() => setFilms([]));
    }
  }, [isOpen, tab]);

  if (!isOpen) return null;

  const play = (movie: Partial<MovieInfo>) => {
    onSaveMovie({ posterUrl: '', duration: 0, ...movie });
    onClose();
  };

  const handleCheck = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch('/api/check-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoUrl.trim() }),
      });
      setCheckResult(await res.json());
    } catch {
      setCheckResult({ success: false, message: 'بررسی لینک ناموفق بود.' });
    } finally {
      setChecking(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isVideoFile(file)) {
      showToast('فایل ویدیویی انتخاب کنید.', 'warning');
      return;
    }
    setUploadProgress(0);
    try {
      const result = await uploadVideo(file, setUploadProgress);
      play({ title: title.trim() || result.title, videoUrl: result.url });
    } catch (err: any) {
      showToast(err.message, 'warning');
    } finally {
      setUploadProgress(null);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'url', label: 'لینک', icon: <Link2 className="w-4 h-4" /> },
    { id: 'upload', label: 'آپلود', icon: <Upload className="w-4 h-4" /> },
    { id: 'films', label: 'فیلم‌های سرور', icon: <HardDrive className="w-4 h-4" /> },
  ];
  const inputClass =
    'w-full bg-[#0c1020] border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" dir="rtl" onClick={onClose}>
      <div
        className="bg-[#101426] border border-slate-700/80 rounded-2xl w-full max-w-lg flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="font-bold text-white">انتخاب فیلم</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-slate-800 px-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`py-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 ${
                tab === t.id ? 'border-purple-500 text-purple-300' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto text-xs space-y-3">
          {tab !== 'films' && (
            <input type="text" placeholder="عنوان (اختیاری)" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          )}

          {tab === 'url' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (videoUrl.trim()) play({ title: title.trim() || 'فیلم آنلاین', videoUrl: videoUrl.trim() });
              }}
              className="space-y-3"
            >
              <div className="flex gap-2">
                <input
                  type="url"
                  required
                  dir="ltr"
                  placeholder="https://example.com/movie.mp4"
                  value={videoUrl}
                  onChange={(e) => {
                    setVideoUrl(e.target.value);
                    setCheckResult(null);
                  }}
                  className={`${inputClass} font-mono`}
                />
                <button
                  type="button"
                  onClick={handleCheck}
                  disabled={checking || !videoUrl.trim()}
                  className="px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold disabled:opacity-50 shrink-0"
                >
                  {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'بررسی'}
                </button>
              </div>

              {checkResult && (
                <div
                  className={`p-2.5 rounded-xl border ${
                    checkResult.success ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200' : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                  }`}
                >
                  <p>{checkResult.message}</p>
                  {!checkResult.success && !videoUrl.includes('/api/proxy-stream') && (
                    <button
                      type="button"
                      onClick={() => {
                        setVideoUrl(`/api/proxy-stream?url=${encodeURIComponent(videoUrl.trim())}`);
                        setCheckResult(null);
                      }}
                      className="mt-2 px-2 py-1 bg-purple-600/40 hover:bg-purple-600/60 rounded-lg text-purple-100 font-semibold"
                    >
                      پخش از طریق سرور
                    </button>
                  )}
                </div>
              )}

              <button type="submit" className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-sm">
                پخش
              </button>
            </form>
          )}

          {tab === 'upload' && (
            <label className="relative border-2 border-dashed border-slate-700 hover:border-purple-500/60 rounded-2xl p-8 flex flex-col items-center gap-3 cursor-pointer">
              <input type="file" accept="video/*,.mkv" onChange={handleFile} disabled={uploadProgress !== null} className="hidden" />
              {uploadProgress === null ? (
                <>
                  <Upload className="w-8 h-8 text-purple-400" />
                  <span className="font-bold text-white text-sm">انتخاب فایل</span>
                  <span className="text-slate-500">حداکثر ۵۰۰ مگابایت</span>
                </>
              ) : (
                <div className="w-full max-w-xs flex flex-col items-center gap-2">
                  <Loader2 className="w-7 h-7 animate-spin text-purple-400" />
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500 transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <span className="text-purple-300 font-mono">{uploadProgress}%</span>
                </div>
              )}
            </label>
          )}

          {tab === 'films' &&
            (films === null ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
              </div>
            ) : films.length === 0 ? (
              <p className="py-8 text-center text-slate-500">هنوز فیلمی آپلود نشده است.</p>
            ) : (
              <div className="space-y-2">
                {films.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => play({ title: f.title, videoUrl: f.url })}
                    className="w-full p-3 rounded-xl bg-[#0c1020] hover:bg-slate-800/80 border border-slate-800 hover:border-purple-500/50 flex items-center gap-3 text-right"
                  >
                    <Film className="w-5 h-5 text-purple-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-white truncate">{f.title}</div>
                      <div className="text-[11px] text-slate-400">
                        {f.formattedSize} · آخرین تماشا: {timeAgo(f.lastWatchedAt)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};
