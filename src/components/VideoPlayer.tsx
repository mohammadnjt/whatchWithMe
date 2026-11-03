import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  PictureInPicture,
  Loader2,
  Film,
  AlertTriangle,
  RefreshCw,
  Download,
  Server,
} from 'lucide-react';
import { formatTime } from '../utils/formatTime';
import { MovieInfo } from '../types';

interface VideoErrorInfo {
  message: string;
  canProxy: boolean;
  canDownload: boolean;
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

const PROXY_PREFIX = '/api/proxy-stream?url=';

/** The original link behind a proxied URL. */
function rawUrlOf(videoUrl: string): string {
  return videoUrl.startsWith(PROXY_PREFIX) ? decodeURIComponent(videoUrl.slice(PROXY_PREFIX.length)) : videoUrl;
}

function describeError(videoUrl: string, code: number | 'timeout'): VideoErrorInfo {
  const isExternal = /^https?:\/\//.test(videoUrl);
  const isProxied = videoUrl.startsWith(PROXY_PREFIX);
  let message = 'پخش این ویدیو ممکن نیست.';
  if (code === 'timeout') message = 'سرور ویدیو پاسخ نداد.';
  else if (code === 2) message = 'ارتباط با سرور ویدیو قطع شد.';
  else if (code === 3) message = 'مرورگر نمی‌تواند این فایل را پخش کند.';
  else if (code === 4) {
    message = isProxied
      ? 'سرور فیلم در دسترس نیست.'
      : isExternal
      ? 'سرور فیلم اجازه پخش مستقیم نمی‌دهد.'
      : 'فرمت این فایل پشتیبانی نمی‌شود.';
  }
  if (videoUrl.toLowerCase().includes('.mkv')) message += ' فایل‌های MKV معمولاً در مرورگر پخش نمی‌شوند.';
  return { message, canProxy: isExternal && !isProxied, canDownload: isExternal || isProxied };
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
  const controlsTimeoutRef = useRef<any>(null);

  const [localCurrentTime, setLocalCurrentTime] = useState(currentTime || 0);
  const [localDuration, setLocalDuration] = useState(duration || 0);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState(0);
  const [videoError, setVideoError] = useState<VideoErrorInfo | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Volume is per viewer and never synced.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
  }, [volume, isMuted, videoRef, videoUrl]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Reset on source change; give up if nothing loads within 12 seconds.
  useEffect(() => {
    setVideoError(null);
    setIsConnecting(Boolean(videoUrl));
    setIsBuffering(false);
    if (!videoUrl) return;
    const timeout = setTimeout(() => {
      const video = videoRef.current;
      if (video && video.readyState === 0 && !video.error) {
        setIsConnecting(false);
        setVideoError(describeError(videoUrl, 'timeout'));
        if (isPlaying) onPlayAction('pause', 0);
      }
    }, 12000);
    return () => clearTimeout(timeout);
  }, [videoUrl, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => setLocalCurrentTime(video.currentTime);
    const onLoadedMetadata = () => {
      setIsConnecting(false);
      setVideoError(null);
      if (video.duration > 0 && isFinite(video.duration)) setLocalDuration(video.duration);
    };
    const onReady = () => {
      setIsConnecting(false);
      setIsBuffering(false);
      setVideoError(null);
    };
    const onWaiting = () => setIsBuffering(true);
    const onError = () => {
      if (isPlaying) onPlayAction('pause', 0);
      setIsBuffering(false);
      setIsConnecting(false);
      setVideoError(describeError(videoUrl, video.error?.code || 4));
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('canplay', onReady);
    video.addEventListener('playing', onReady);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('playing', onReady);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onError);
    };
  }, [videoRef, videoUrl, isPlaying, onPlayAction]);

  const handleUseProxy = () => {
    onSaveMovie?.({ videoUrl: PROXY_PREFIX + encodeURIComponent(rawUrlOf(videoUrl)) });
    setVideoError(null);
    setIsConnecting(true);
  };

  const handleDownloadToServer = async () => {
    setIsDownloading(true);
    showToast('دانلود روی سرور شروع شد…', 'info');
    try {
      const res = await fetch('/api/storage/remote-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrlOf(videoUrl), title }),
      });
      const data = await res.json();
      if (data.success && data.url) {
        onSaveMovie?.({ videoUrl: data.url });
        setVideoError(null);
        showToast(`روی سرور ذخیره شد (${data.formattedSize}).`, 'success');
      } else {
        showToast(data.error || 'دانلود ناموفق بود.', 'warning');
      }
    } catch (err: any) {
      showToast(err.message, 'warning');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRetry = () => {
    setVideoError(null);
    setIsConnecting(true);
    videoRef.current?.load();
  };

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

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (videoError || !video) return;
    if (isPlaying) {
      onPlayAction('pause', video.currentTime);
      video.pause();
    } else {
      onPlayAction('play', video.currentTime);
      video.play().catch(() => {});
    }
  }, [isPlaying, onPlayAction, videoRef, videoError]);

  const timeAt = (clientX: number) => {
    const rect = progressBarRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return { x, time: (x / rect.width) * localDuration };
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (videoError || !progressBarRef.current) return;
    const { time } = timeAt(e.clientX);
    setLocalCurrentTime(time);
    if (videoRef.current) videoRef.current.currentTime = time;
    onPlayAction('seek', time);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  const togglePiP = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await videoRef.current?.requestPictureInPicture();
    } catch {
      showToast('مرورگر از پخش شناور پشتیبانی نمی‌کند.', 'warning');
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
    onPlayAction('rate', localCurrentTime, speed);
    setShowSettings(false);
  };

  const progressPercent = localDuration > 0 ? (localCurrentTime / localDuration) * 100 : 0;

  if (!videoUrl) {
    return (
      <div className="w-full aspect-video rounded-2xl sm:rounded-3xl bg-[#090c1a] border border-purple-500/20 flex flex-col items-center justify-center gap-4 p-6 text-center" dir="rtl">
        <Film className="w-10 h-10 text-purple-400" />
        <p className="text-lg font-bold text-white">فیلمی انتخاب نشده است</p>
        {onOpenChangeMovie && (
          <button onClick={onOpenChangeMovie} className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-semibold">
            انتخاب فیلم
          </button>
        )}
      </div>
    );
  }

  const actionBtn = 'py-2 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5';

  return (
    <div
      ref={containerRef}
      dir="ltr"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setIsControlsVisible(false)}
      className="relative w-full aspect-video rounded-2xl sm:rounded-3xl overflow-hidden bg-black border border-slate-800/80 group select-none"
    >
      <video
        ref={videoRef}
        src={videoUrl}
        poster={posterUrl || undefined}
        playsInline
        preload="auto"
        onClick={togglePlay}
        className="w-full h-full object-contain cursor-pointer"
      />

      {(isBuffering || isConnecting) && !videoError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none z-20">
          <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
        </div>
      )}

      {!isPlaying && !isBuffering && !isConnecting && !videoError && (
        <div onClick={togglePlay} className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/25 z-10">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-purple-600/80 hover:bg-purple-600 flex items-center justify-center hover:scale-110 transition-transform">
            <Play className="w-8 h-8 sm:w-10 sm:h-10 ml-1 text-white fill-white" />
          </div>
        </div>
      )}

      {videoError && (
        <div className="absolute inset-0 z-30 bg-black/85 flex items-center justify-center p-4" dir="rtl">
          <div className="max-w-md w-full flex flex-col items-center gap-4 text-center">
            <AlertTriangle className="w-9 h-9 text-red-400" />
            <p className="text-sm text-slate-100">{videoError.message}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {videoError.canProxy && (
                <button onClick={handleUseProxy} className={`${actionBtn} bg-purple-600 hover:bg-purple-500 text-white`}>
                  <Server className="w-3.5 h-3.5" />
                  پخش از طریق سرور
                </button>
              )}
              {videoError.canDownload && (
                <button
                  onClick={handleDownloadToServer}
                  disabled={isDownloading}
                  className={`${actionBtn} bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-100 disabled:opacity-50`}
                >
                  {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  دانلود روی سرور
                </button>
              )}
              <button onClick={handleRetry} className={`${actionBtn} bg-slate-800 hover:bg-slate-700 text-slate-200`}>
                <RefreshCw className="w-3.5 h-3.5" />
                تلاش مجدد
              </button>
              {onOpenChangeMovie && (
                <button onClick={onOpenChangeMovie} className={`${actionBtn} bg-slate-800 hover:bg-slate-700 text-slate-200`}>
                  <Film className="w-3.5 h-3.5" />
                  تغییر فیلم
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {!videoError && !isConnecting && (
        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/60 text-[11px] text-emerald-300 font-mono pointer-events-none z-10">
          sync · {latencyMs}ms
        </div>
      )}

      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent pt-10 pb-3 px-4 sm:px-6 transition-opacity duration-300 z-20 ${
          isControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        } ${videoError ? 'hidden' : ''}`}
      >
        <div
          ref={progressBarRef}
          onClick={handleSeek}
          onMouseMove={(e) => {
            if (!progressBarRef.current) return;
            const { x, time } = timeAt(e.clientX);
            setHoverPosition(x);
            setHoverTime(time);
          }}
          onMouseLeave={() => setHoverTime(null)}
          className="relative w-full h-2 hover:h-3 bg-slate-700/80 rounded-full cursor-pointer mb-3 transition-all"
        >
          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" style={{ width: `${progressPercent}%` }}>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-purple-500" />
          </div>
          {hoverTime !== null && (
            <div
              className="absolute -top-8 px-2 py-0.5 rounded bg-black/90 text-white text-[11px] font-mono pointer-events-none -translate-x-1/2"
              style={{ left: `${hoverPosition}px` }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-white text-sm">
          <div className="flex items-center gap-3">
            <button onClick={togglePlay} className="p-1.5 hover:text-purple-400">
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>
            <div className="flex items-center gap-2">
              <button onClick={() => setIsMuted(!isMuted)} className="p-1.5 hover:text-purple-400">
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
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
                className="w-14 sm:w-20 h-1 accent-purple-500 cursor-pointer"
              />
            </div>
            <span className="font-mono text-xs sm:text-sm text-slate-300">
              {formatTime(localCurrentTime)} <span className="text-slate-500">/</span> {formatTime(localDuration)}
            </span>
          </div>

          <div className="flex items-center gap-2 relative">
            <div className="relative">
              <button onClick={() => setShowSettings(!showSettings)} className={`p-1.5 rounded-md ${showSettings ? 'text-purple-400' : 'text-slate-300 hover:text-white'}`}>
                <Settings className="w-5 h-5" />
              </button>
              {showSettings && (
                <div className="absolute right-0 bottom-9 w-28 bg-[#111425] border border-slate-700/80 rounded-xl p-1.5 z-50 text-xs">
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => handleSpeedChange(rate)}
                      className={`w-full text-left px-2 py-1.5 rounded font-mono ${
                        playbackSpeed === rate ? 'bg-purple-600/30 text-purple-300 font-bold' : 'text-slate-300 hover:bg-slate-800/80'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={togglePiP} className="p-1.5 text-slate-300 hover:text-white">
              <PictureInPicture className="w-5 h-5" />
            </button>
            <button onClick={toggleFullscreen} className="p-1.5 text-slate-300 hover:text-white">
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
