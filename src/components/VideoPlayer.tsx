import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Subtitles,
  PictureInPicture,
  CheckCircle2,
  Signal,
  Loader2,
  Sparkles,
  Upload,
  Link2,
  Film,
  AlertTriangle,
  RefreshCw,
  Download,
  Activity,
  Check,
  Copy,
  ShieldAlert,
} from 'lucide-react';
import { formatTime } from '../utils/formatTime';
import { MovieInfo } from '../types';

interface VideoErrorInfo {
  code: number;
  title: string;
  message: string;
  details?: string;
  canProxy: boolean;
  canDownload: boolean;
  isMkv?: boolean;
}

interface VideoPlayerProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl?: string;
  posterUrl?: string;
  title?: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  latencyMs: number;
  onPlayAction: (action: 'play' | 'pause' | 'seek' | 'rate', time: number, rate?: number) => void;
  onSaveMovie?: (movie: Partial<MovieInfo>) => void;
  onOpenChangeMovie?: () => void;
  showToast: (text: string, variant?: string) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoRef,
  videoUrl = '',
  posterUrl = '',
  title = '',
  isPlaying,
  currentTime,
  duration,
  latencyMs,
  onPlayAction,
  onSaveMovie,
  onOpenChangeMovie,
  showToast,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  const [localCurrentTime, setLocalCurrentTime] = useState(currentTime || 0);
  const [localDuration, setLocalDuration] = useState(duration || 8910);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);

  // Video error & connection state
  const [videoError, setVideoError] = useState<VideoErrorInfo | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCheckingUrl, setIsCheckingUrl] = useState(false);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [isDownloadingRemote, setIsDownloadingRemote] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Empty state handling
  const [emptyTab, setEmptyTab] = useState<'upload' | 'url'>('upload');
  const [inlineUrl, setInlineUrl] = useState('');
  const [inlineTitle, setInlineTitle] = useState('');
  const [inlineUploading, setInlineUploading] = useState(false);
  const [inlineUploadProgress, setInlineUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInlineFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|mkv|webm|avi|mov)$/i)) {
      showToast('لطفاً یک فایل ویدیویی معتبر انتخاب کنید (.mp4, .mkv, .webm)', 'warning');
      return;
    }

    setInlineUploading(true);
    setInlineUploadProgress(10);

    try {
      const formData = new FormData();
      formData.append('video', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload', true);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 95);
          setInlineUploadProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setInlineUploadProgress(100);
          const data = JSON.parse(xhr.responseText);
          const cleanName = file.name.replace(/\.[^/.]+$/, '');
          if (onSaveMovie) {
            onSaveMovie({
              title: cleanName,
              videoUrl: data.url,
              genre: 'Uploaded Video',
              year: new Date().getFullYear().toString(),
              tagline: `ویدیو آپلود شده: ${file.name}`,
              posterUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=800&auto=format&fit=crop',
            });
          }
          showToast(`فیلم "${cleanName}" با موفقیت آپلود و بارگذاری شد!`, 'success');
        } else {
          throw new Error('Upload failed');
        }
        setInlineUploading(false);
      };

      xhr.onerror = () => {
        setInlineUploading(false);
        const localBlob = URL.createObjectURL(file);
        if (onSaveMovie) {
          onSaveMovie({
            title: file.name,
            videoUrl: localBlob,
            genre: 'Local Video',
            year: new Date().getFullYear().toString(),
            tagline: `فایل محلی: ${file.name}`,
          });
        }
        showToast('فیلم به صورت محلی بارگذاری شد.', 'info');
      };

      xhr.send(formData);
    } catch {
      setInlineUploading(false);
      showToast('خطا در بارگذاری فایل ویدیو.', 'warning');
    }
  };

  const handleInlineUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineUrl.trim()) {
      showToast('لطفاً لینک مستقیم ویدیو را وارد کنید.', 'warning');
      return;
    }

    const cleanTitle = inlineTitle.trim() || 'فیلم آنلاین';
    if (onSaveMovie) {
      onSaveMovie({
        title: cleanTitle,
        videoUrl: inlineUrl.trim(),
        genre: 'Online Stream',
        year: new Date().getFullYear().toString(),
        tagline: 'پخش همزمان فیلم با لینک مستقیم.',
        posterUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=800&auto=format&fit=crop',
      });
    }
    showToast(`فیلم "${cleanTitle}" برای همه بارگذاری شد.`, 'success');
  };

  const controlsTimeoutRef = useRef<any>(null);

  // Apply the volume controls to the video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted, videoRef, videoUrl]);

  // Watchdog & state reset on videoUrl change
  useEffect(() => {
    setVideoError(null);
    setCheckResult(null);
    setIsConnecting(Boolean(videoUrl));
    setIsBuffering(false);

    if (!videoUrl) return;

    // Timeout watchdog: If after 12s video hasn't loaded metadata or errored out
    const timeout = setTimeout(() => {
      const video = videoRef.current;
      if (video && video.readyState === 0 && !video.error && videoUrl) {
        setIsConnecting(false);
        const isExternal = videoUrl.startsWith('http://') || videoUrl.startsWith('https://');
        const isMkv = videoUrl.toLowerCase().includes('.mkv');
        const isProxied = videoUrl.includes('/api/proxy-stream');

        setVideoError({
          code: 5,
          title: 'عدم پاسخگویی سرور ویدیو (Connection Timeout)',
          message: 'سرور میزبان ویدیو در مهلت مقرر پاسخی ارسال نکرد. ممکن است سرور مسدود، قطع یا بیش از حد کند باشد.',
          details: 'اگر لینک از هاست‌های دانلود ایرانی یا دارای محدودیت آی‌پی است، استفاده از «پروکسی سرور» یا «دانلود مستقیم روی سرور» مشکل را برطرف می‌کند.',
          canProxy: isExternal && !isProxied,
          canDownload: isExternal,
          isMkv,
        });

        if (isPlaying) {
          onPlayAction('pause', 0);
        }
      }
    }, 12000);

    return () => clearTimeout(timeout);
  }, [videoUrl, videoRef]);

  // Video event listeners & sync to UI display
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setLocalCurrentTime(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      setIsConnecting(false);
      setVideoError(null);
      if (video.duration && !isNaN(video.duration) && video.duration > 0) {
        setLocalDuration(video.duration);
      }
    };

    const handleCanPlay = () => {
      setIsConnecting(false);
      setIsBuffering(false);
      setVideoError(null);
    };

    const handleWaiting = () => {
      if (!videoError) setIsBuffering(true);
    };

    const handlePlaying = () => {
      setIsBuffering(false);
      setIsConnecting(false);
      setVideoError(null);
    };

    const handleError = () => {
      const mediaError = video.error;
      const code = mediaError?.code || 4;

      // Crucial: Stop simulated play state so app does NOT fake-play!
      if (isPlaying) {
        onPlayAction('pause', 0);
      }
      setIsBuffering(false);
      setIsConnecting(false);

      const isExternal = videoUrl.startsWith('http://') || videoUrl.startsWith('https://');
      const isMkv = videoUrl.toLowerCase().includes('.mkv');
      const isProxied = videoUrl.includes('/api/proxy-stream');

      let title = 'خطا در اتصال و پخش ویدیو';
      let message = 'امکان اتصال به فایل ویدیویی یا پخش آن در مرورگر وجود ندارد.';
      let details = '';

      if (code === 1) {
        title = 'توقف دریافت ویدیو (Aborted)';
        message = 'بارگذاری ویدیو لغو شد.';
      } else if (code === 2) {
        title = 'خطای شبکه در دریافت ویدیو (Network Error)';
        message = 'ارتباط اینترنتی با سرور میزبان ویدیو در هنگام دریافت قطع گردید.';
      } else if (code === 3) {
        title = 'خطای پردازش و کدک ویدیو (Decode Error)';
        message = 'فایل ویدیویی آسیب دیده است یا کدک صوتی/تصویری آن توسط مرورگر پشتیبانی نمی‌شود.';
      } else if (code === 4) {
        title = 'عدم دسترسی به ویدیو یا عدم پشتیبانی فرمت (Source Not Supported)';
        if (isExternal && !isProxied) {
          message = 'سرور میزبان این فیلم اجازه اتصال مرورگری نداده است (خطای ۵۰۳ در دسترس نبودن، ۴۰۳ ممنوع یا عدم تنظیم مجوز CORS).';
          details = 'سایت‌های دانلود فیلم (مانند Aparatchi، Film2Media و...) لینک مستقیم را با آنتی‌ربات، خطای ۵۰۳ یا مسدودسازی مرورگر محافظت می‌کنند.';
        } else if (isProxied) {
          message = 'سرور پروکسی نیز نتوانست این ویدیو را از مبدا دریافت کند (سرور میزبان فیلم موقتاً قطع است یا پاسخ ۵۰۳ می‌دهد).';
        } else {
          message = 'فرمت ویدیویی یا کدک‌های موجود در این فایل در مرورگر شما قابل اجرا نیستند.';
        }
      }

      if (isMkv) {
        details += (details ? '\n' : '') + 'این فایل دارای پسوند MKV است. اکثر مرورگرها (مانند کروم و سافاری) به دلیل کدک صوتی AC3/EAC3 فایل MKV را بدون واسطه پخش نمی‌کنند.';
      }

      setVideoError({
        code,
        title,
        message,
        details,
        canProxy: isExternal && !isProxied,
        canDownload: isExternal,
        isMkv,
      });
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('error', handleError);
    };
  }, [videoRef, videoUrl, isPlaying, onPlayAction, videoError]);

  // Actions for resolving video errors
  const handleUseProxyStream = () => {
    if (!videoUrl) return;
    const rawUrl = videoUrl.startsWith('/api/proxy-stream?url=')
      ? decodeURIComponent(videoUrl.split('?url=')[1])
      : videoUrl;

    const proxied = `/api/proxy-stream?url=${encodeURIComponent(rawUrl)}`;
    if (onSaveMovie) {
      onSaveMovie({ videoUrl: proxied });
    }
    setVideoError(null);
    setIsConnecting(true);
    showToast('در حال پخش از طریق سرور پروکسی با پشتیبانی کامل از CORS و استریم...', 'info');
  };

  const handleDiagnoseLink = async () => {
    if (!videoUrl) return;
    const rawUrl = videoUrl.startsWith('/api/proxy-stream?url=')
      ? decodeURIComponent(videoUrl.split('?url=')[1])
      : videoUrl;

    setIsCheckingUrl(true);
    setCheckResult(null);

    try {
      const res = await fetch('/api/check-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl }),
      });
      const data = await res.json();
      setCheckResult(data);
    } catch (err: any) {
      setCheckResult({
        success: false,
        statusCode: 0,
        statusMessage: 'Failed to contact backend',
        message: `خطا در اجرای تست سرور: ${err.message}`,
      });
    } finally {
      setIsCheckingUrl(false);
    }
  };

  const handleDownloadToServer = async () => {
    if (!videoUrl) return;
    const rawUrl = videoUrl.startsWith('/api/proxy-stream?url=')
      ? decodeURIComponent(videoUrl.split('?url=')[1])
      : videoUrl;

    setIsDownloadingRemote(true);
    showToast('دانلود فیلم روی سرور WatchTogether آغاز شد. لطفاً صبور باشید...', 'info');

    try {
      const res = await fetch('/api/storage/remote-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl, title }),
      });
      const data = await res.json();

      if (data.success && data.url) {
        if (onSaveMovie) {
          onSaveMovie({ videoUrl: data.url });
        }
        setVideoError(null);
        showToast(`فیلم با موفقیت در سرور ذخیره شد (${data.formattedSize}) و آماده پخش بدون قطعی است!`, 'success');
      } else {
        showToast(data.error || 'دانلود فایل با خطا مواجه شد.', 'warning');
      }
    } catch (err: any) {
      showToast(`خطا در فرآیند دانلود: ${err.message}`, 'warning');
    } finally {
      setIsDownloadingRemote(false);
    }
  };

  const handleRetry = () => {
    setVideoError(null);
    setCheckResult(null);
    setIsConnecting(true);
    if (videoRef.current) {
      videoRef.current.load();
    }
    showToast('تلاش مجدد برای بارگذاری ویدیو...', 'info');
  };

  const handleCopyLink = () => {
    if (!videoUrl) return;
    const rawUrl = videoUrl.startsWith('/api/proxy-stream?url=')
      ? decodeURIComponent(videoUrl.split('?url=')[1])
      : videoUrl;
    navigator.clipboard.writeText(rawUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
    showToast('لینک مستقیم ویدیو کپی شد.', 'info');
  };

  // Controls auto-hide when idle
  const handleMouseMove = () => {
    setIsControlsVisible(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !videoError) {
        setIsControlsVisible(false);
        setShowSettings(false);
      }
    }, 3200);
  };

  // Play / Pause toggle with error guard
  const togglePlay = useCallback(() => {
    if (videoError) {
      showToast('به دلیل خطای بارگذاری ویدیو، امکان پخش وجود ندارد. لطفاً ابتدا خطای زیر را بررسی نمایید.', 'warning');
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      onPlayAction('pause', video.currentTime);
      video.pause();
    } else {
      onPlayAction('play', video.currentTime);
      video.play().catch((err) => {
        console.warn('Video playback could not start:', err);
      });
    }
  }, [isPlaying, onPlayAction, videoRef, videoError, showToast]);

  // Seeking via timeline click or drag
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (videoError) {
      showToast('به دلیل خطای اتصال ویدیو، امکان تغییر زمان وجود ندارد.', 'warning');
      return;
    }
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = clickX / rect.width;
    const targetTime = percent * localDuration;

    setLocalCurrentTime(targetTime);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
    }
    onPlayAction('seek', targetTime);
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = clickX / rect.width;
    setHoverPosition(clickX);
    setHoverTime(percent * localDuration);
  };

  const handleTimelineMouseLeave = () => {
    setHoverTime(null);
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // PiP toggle
  const togglePiP = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (videoRef.current) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch {
      showToast('Picture-in-picture is not supported or was blocked by browser', 'warning');
    }
  };

  // Change playback speed
  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    onPlayAction('rate', localCurrentTime, speed);
    setShowSettings(false);
    showToast(`Speed set to ${speed}x for everyone`, 'info');
  };

  const progressPercent = localDuration > 0 ? (localCurrentTime / localDuration) * 100 : 0;

  // When no movie videoUrl is present, render the empty state for selecting or uploading a video
  if (!videoUrl) {
    return (
      <div className="relative w-full aspect-video rounded-2xl sm:rounded-3xl overflow-hidden bg-[#090c1a] border border-purple-500/20 shadow-2xl flex flex-col items-center justify-center p-6 text-center select-none">
        {/* Ambient background glow */}
        <div className="absolute -inset-1 bg-gradient-to-tr from-purple-900/20 via-transparent to-indigo-900/20 pointer-events-none" />

        <div className="relative z-10 max-w-lg w-full flex flex-col items-center gap-3.5">
          {/* Glowing Film Icon */}
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-purple-600/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-xl shadow-purple-950/50">
            <Film className="w-7 h-7 sm:w-8 sm:h-8" />
          </div>

          <div>
            <h3 className="text-lg sm:text-2xl font-bold text-white tracking-tight">
              هنوز فیلمی برای این اتاق انتخاب نشده است
            </h3>
          </div>

          {/* Toggle between Upload and Direct URL */}
          <div className="flex items-center bg-[#13162b] p-1 rounded-xl border border-slate-700/60 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setEmptyTab('upload')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
                emptyTab === 'upload'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>انتخاب و آپلود فایل</span>
            </button>
            <button
              type="button"
              onClick={() => setEmptyTab('url')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
                emptyTab === 'url'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>لینک مستقیم ویدیو</span>
            </button>
          </div>

          {/* Tab 1: Upload Form */}
          {emptyTab === 'upload' && (
            <div className="w-full">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mkv,.mp4,.webm,.avi,.mov"
                onChange={handleInlineFileUpload}
                className="hidden"
              />

              {inlineUploading ? (
                <div className="w-full bg-[#121629] border border-purple-500/40 rounded-2xl p-4 sm:p-5 flex flex-col items-center gap-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-purple-300">
                    <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                    <span>در حال آپلود ویدیو روی سرور ({inlineUploadProgress}٪)...</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-300 rounded-full"
                      style={{ width: `${inlineUploadProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-purple-500/30 hover:border-purple-400/70 bg-[#121629]/70 hover:bg-[#161a33] rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all group"
                >
                  <div className="w-9 h-9 rounded-full bg-purple-600/20 text-purple-300 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Upload className="w-4 h-4" />
                  </div>
                  <div className="text-xs sm:text-sm font-semibold text-white group-hover:text-purple-200">
                    برای انتخاب فایل ویدیو کلیک کنید (Browse)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    فرمت‌های MP4، MKV، WebM، AVI پشتیبانی می‌شوند
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Direct URL Form */}
          {emptyTab === 'url' && (
            <form onSubmit={handleInlineUrlSubmit} className="w-full flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="url"
                  required
                  value={inlineUrl}
                  onChange={(e) => setInlineUrl(e.target.value)}
                  placeholder="https://example.com/movie.mp4"
                  dir="ltr"
                  className="flex-1 bg-[#101426] border border-slate-700/80 focus:border-purple-500 rounded-xl px-3 py-1.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-purple-600/30 transition-all"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>پخش</span>
                </button>
              </div>
              <input
                type="text"
                value={inlineTitle}
                onChange={(e) => setInlineTitle(e.target.value)}
                placeholder="عنوان فیلم (اختیاری)"
                className="w-full bg-[#101426] border border-slate-700/80 focus:border-purple-500 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none"
              />
            </form>
          )}

          {/* Secondary Option: Open Advanced Modal */}
          {onOpenChangeMovie && (
            <button
              type="button"
              onClick={onOpenChangeMovie}
              className="text-xs text-purple-300 hover:text-purple-200 underline underline-offset-4 transition-colors flex items-center gap-1 mt-1"
            >
              <Sparkles className="w-3 h-3 text-purple-400" />
              <span>انتخاب از فیلم‌های ذخیره‌شده روی سرور</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        if (isPlaying) setIsControlsVisible(false);
      }}
      className="relative w-full aspect-video rounded-2xl sm:rounded-3xl overflow-hidden bg-black shadow-2xl border border-slate-800/80 group select-none"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={videoUrl}
        poster={posterUrl}
        playsInline
        preload="auto"
        onClick={togglePlay}
        className="w-full h-full object-cover cursor-pointer"
      />

      {/* Mock cinematic subtitles overlay if enabled */}
      {subtitlesEnabled && isPlaying && !videoError && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-lg bg-black/75 backdrop-blur-sm text-yellow-300 font-medium text-sm sm:text-base tracking-wide text-center max-w-[85%] pointer-events-none drop-shadow-md">
          {localCurrentTime < 1470
            ? "We used to look up at the sky and wonder at our place in the stars..."
            : "Now we just look down and worry about our place in the dirt."}
        </div>
      )}

      {/* Buffering Indicator */}
      {isBuffering && !videoError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[2px] pointer-events-none z-20">
          <div className="flex flex-col items-center gap-2 bg-[#0c1020]/90 px-6 py-4 rounded-2xl border border-purple-500/30 shadow-2xl">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            <span className="text-xs text-purple-200 font-medium tracking-wider">در حال بافر و همگام‌سازی ویدیو...</span>
          </div>
        </div>
      )}

      {/* Connecting Indicator (Initial link connection) */}
      {isConnecting && !videoError && !isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px] pointer-events-none z-20">
          <div className="flex flex-col items-center gap-2 bg-[#0c1020]/90 px-6 py-4 rounded-2xl border border-purple-500/30 shadow-2xl">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <span className="text-xs text-indigo-200 font-medium">در حال اتصال به سرور میزبان ویدیو...</span>
          </div>
        </div>
      )}

      {/* Center play icon pulse on pause (Only when no error) */}
      {!isPlaying && !isBuffering && !videoError && !isConnecting && (
        <div
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/25 group-hover:bg-black/35 transition-colors z-10"
        >
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-purple-600/80 hover:bg-purple-600 text-white flex items-center justify-center backdrop-blur-md shadow-2xl shadow-purple-600/50 hover:scale-110 active:scale-95 transition-all">
            <Play className="w-8 h-8 sm:w-10 sm:h-10 ml-1 fill-white" />
          </div>
        </div>
      )}

      {/* COMPREHENSIVE ERROR DIAGNOSTIC OVERLAY */}
      {videoError && (
        <div className="absolute inset-0 z-30 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto select-text text-right" dir="rtl">
          <div className="max-w-xl w-full bg-[#0d1022]/95 border border-red-500/40 rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl shadow-red-950/60 flex flex-col gap-4 text-slate-100">
            {/* Header */}
            <div className="flex items-start gap-3.5 border-b border-red-500/20 pb-3.5">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-red-950/80 border border-red-500/50 flex items-center justify-center text-red-400 shrink-0 shadow-lg shadow-red-950/80">
                <ShieldAlert className="w-6 h-6 animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                    {videoError.title}
                  </h3>
                  <span className="text-[10px] bg-red-950 text-red-300 border border-red-700/60 px-2 py-0.5 rounded-full font-mono">
                    کد خطا: {videoError.code}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-red-200/90 mt-1 leading-relaxed">
                  {videoError.message}
                </p>
              </div>
            </div>


            {/* Requested URL display with Copy Button */}
            <div className="bg-[#090b16] rounded-xl p-2.5 border border-slate-800 text-[11px] font-mono flex items-center justify-between gap-2">
              <span className="text-slate-400 truncate flex-1 text-left" dir="ltr">
                {videoUrl}
              </span>
              <button
                type="button"
                onClick={handleCopyLink}
                className="shrink-0 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1 transition-colors"
                title="کپی آدرس ویدیو"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="text-[11px] font-sans">{copiedUrl ? 'کپی شد' : 'کپی لینک'}</span>
              </button>
            </div>

            {/* Live Diagnosis Result (If user clicked Check) */}
            {checkResult && (
              <div
                className={`p-3 rounded-xl border text-xs font-sans flex flex-col gap-1.5 ${
                  checkResult.success
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                    : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                }`}
              >
                <div className="flex items-center justify-between font-bold">
                  <span>نتیجه تست زنده سلامت لینک:</span>
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-black/40">
                    HTTP {checkResult.statusCode || 'Failed'}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed">{checkResult.message}</p>
                {checkResult.contentType && (
                  <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-1">
                    <span>فرمت دریافتی: {checkResult.contentType}</span>
                    <span>• حجم: {checkResult.formattedSize}</span>
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons Grid */}
            <div className="flex flex-wrap items-center gap-2 mt-1 pt-2 border-t border-slate-800">
              {/* Option 1: Proxy Stream */}
              {videoError.canProxy && (
                <button
                  type="button"
                  onClick={handleUseProxyStream}
                  className="flex-1 min-w-[170px] py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md shadow-purple-600/30 transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                  <span>پخش با سرور پروکسی (پیشنهادی)</span>
                </button>
              )}

              {/* Option 2: Live Link Check */}
              <button
                type="button"
                onClick={handleDiagnoseLink}
                disabled={isCheckingUrl}
                className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 border border-slate-700 transition-colors cursor-pointer"
              >
                <Activity className={`w-3.5 h-3.5 ${isCheckingUrl ? 'animate-spin text-purple-400' : 'text-slate-400'}`} />
                <span>{isCheckingUrl ? 'در حال بررسی...' : 'بررسی زنده سرور (Check)'}</span>
              </button>

              {/* Option 3: Download directly to server disk */}
              {videoError.canDownload && (
                <button
                  type="button"
                  onClick={handleDownloadToServer}
                  disabled={isDownloadingRemote}
                  className="py-2 px-3 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download className={`w-3.5 h-3.5 ${isDownloadingRemote ? 'animate-bounce' : ''}`} />
                  <span>{isDownloadingRemote ? 'در حال دانلود در سرور...' : 'دانلود مستقیم در سرور'}</span>
                </button>
              )}

              {/* Option 4: Retry */}
              <button
                type="button"
                onClick={handleRetry}
                className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 border border-slate-700 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                <span>تلاش مجدد</span>
              </button>

              {/* Option 5: Change Movie / URL */}
              {onOpenChangeMovie && (
                <button
                  type="button"
                  onClick={onOpenChangeMovie}
                  className="py-2 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center justify-center gap-1.5 border border-slate-700/60 transition-colors cursor-pointer"
                >
                  <Film className="w-3.5 h-3.5 text-purple-400" />
                  <span>تغییر فیلم یا لینک</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Floating Badge: Dynamic state badge */}
      {videoError ? (
        <div className="absolute top-4 sm:top-5 left-4 sm:left-6 flex items-center gap-2 bg-red-950/90 backdrop-blur-md border border-red-500/60 text-red-300 px-3 py-1.5 rounded-full text-xs sm:text-sm font-semibold shadow-lg shadow-red-950/70 z-40 pointer-events-none">
          <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse shrink-0" />
          <span>خطا در اتصال ویدیو</span>
        </div>
      ) : isConnecting ? (
        <div className="absolute top-4 sm:top-5 left-4 sm:left-6 flex items-center gap-2 bg-[#0c1020]/90 backdrop-blur-md border border-indigo-500/40 text-indigo-300 px-3 py-1.5 rounded-full text-xs sm:text-sm font-semibold shadow-lg z-40 pointer-events-none">
          <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
          <span>در حال اتصال به ویدیو...</span>
        </div>
      ) : (
        <div className="absolute top-4 sm:top-5 left-4 sm:left-6 flex items-center gap-2 bg-[#0c1020]/80 backdrop-blur-md border border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-full text-xs sm:text-sm font-semibold shadow-lg shadow-emerald-950/40 pointer-events-none z-10">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-slate-100">
            In Sync <span className="text-emerald-400">• {latencyMs}ms</span>
          </span>
          <Signal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        </div>
      )}

      {/* Top Floating Action: Fullscreen button */}
      <button
        onClick={toggleFullscreen}
        title="Toggle Fullscreen"
        className="absolute top-4 sm:top-5 right-4 sm:right-6 w-9 h-9 rounded-xl bg-[#0c1020]/80 hover:bg-purple-600/80 backdrop-blur-md border border-slate-700/60 text-slate-200 hover:text-white flex items-center justify-center shadow-lg transition-all z-40"
      >
        {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
      </button>

      {/* Bottom Player Controls Overlay */}
      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent pt-12 pb-3.5 px-4 sm:px-6 transition-opacity duration-300 z-20 ${
          isControlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Scrubber */}
        <div
          ref={progressBarRef}
          onClick={handleSeek}
          onMouseMove={handleTimelineMouseMove}
          onMouseLeave={handleTimelineMouseLeave}
          className="relative w-full h-2 hover:h-3.5 bg-slate-800/80 rounded-full cursor-pointer mb-3 transition-all group/bar"
        >
          {/* Buffer Progress */}
          <div
            className="absolute top-0 left-0 bottom-0 bg-slate-600/50 rounded-full"
            style={{ width: `${Math.min(100, progressPercent + 15)}%` }}
          />

          {/* Played Progress */}
          <div
            className="absolute top-0 left-0 bottom-0 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full shadow-lg shadow-purple-500/40 relative"
            style={{ width: `${progressPercent}%` }}
          >
            {/* Scrubber Knob Handle */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-white border-2 border-purple-500 shadow-md shadow-purple-600/80 hover:scale-125 transition-transform" />
          </div>

          {/* Hover Time Tooltip */}
          {hoverTime !== null && (
            <div
              className="absolute -top-8 px-2 py-0.5 rounded bg-black/90 text-white text-[11px] font-mono pointer-events-none -translate-x-1/2 border border-slate-700 shadow-lg"
              style={{ left: `${hoverPosition}px` }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between text-white text-sm">
          {/* Left Controls */}
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              onClick={togglePlay}
              className="p-1.5 hover:text-purple-400 transition-colors focus:outline-none"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </button>

            {/* Volume Control */}
            <div className="flex items-center gap-2 group/vol">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="p-1.5 hover:text-purple-400 transition-colors focus:outline-none"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setVolume(val);
                  setIsMuted(val === 0);
                }}
                className="w-14 sm:w-20 h-1 accent-purple-500 bg-slate-700 rounded-lg cursor-pointer transition-opacity"
              />
            </div>

            {/* Time display: 24:17 / 2:28:30 */}
            <span className="font-mono text-xs sm:text-sm text-slate-300 font-medium">
              {formatTime(localCurrentTime)} <span className="text-slate-500">/</span> {formatTime(localDuration)}
            </span>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2 sm:gap-3 relative">
            {/* Subtitles CC Toggle */}
            <button
              onClick={() => {
                setSubtitlesEnabled(!subtitlesEnabled);
                showToast(subtitlesEnabled ? 'Subtitles off' : 'Subtitles on', 'info');
              }}
              className={`p-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${
                subtitlesEnabled ? 'text-purple-400 bg-purple-600/20' : 'text-slate-400 hover:text-white'
              }`}
              title="Closed Captions (CC)"
            >
              <Subtitles className="w-5 h-5" />
            </button>

            {/* Settings Speed Menu */}
            <div className="relative">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-1.5 rounded-md transition-colors ${
                  showSettings ? 'text-purple-400 bg-purple-600/20' : 'text-slate-400 hover:text-white'
                }`}
                title="Playback Settings"
              >
                <Settings className="w-5 h-5" />
              </button>

              {showSettings && (
                <div className="absolute right-0 bottom-9 w-44 bg-[#111425] border border-slate-700/80 rounded-xl shadow-2xl p-2 z-50 text-xs">
                  <div className="px-2 py-1 font-bold text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800 mb-1">
                    Playback Speed
                  </div>
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => handleSpeedChange(rate)}
                      className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between font-mono ${
                        playbackSpeed === rate
                          ? 'bg-purple-600/30 text-purple-300 font-bold'
                          : 'text-slate-300 hover:bg-slate-800/80'
                      }`}
                    >
                      <span>{rate}x</span>
                      {playbackSpeed === rate && <span className="text-purple-400">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Picture-in-Picture */}
            <button
              onClick={togglePiP}
              className="p-1.5 text-slate-400 hover:text-white transition-colors"
              title="Miniplayer / Picture in Picture"
            >
              <PictureInPicture className="w-5 h-5" />
            </button>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-1.5 text-slate-400 hover:text-white transition-colors"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
