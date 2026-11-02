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
} from 'lucide-react';
import { formatTime } from '../utils/formatTime';

interface VideoPlayerProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string;
  posterUrl: string;
  title: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  latencyMs: number;
  onPlayAction: (action: 'play' | 'pause' | 'seek' | 'rate', time: number, rate?: number) => void;
  showToast: (text: string, variant?: string) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoRef,
  videoUrl,
  posterUrl,
  title,
  isPlaying,
  currentTime,
  duration,
  latencyMs,
  onPlayAction,
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

  const controlsTimeoutRef = useRef<any>(null);

  // Sync internal video element time to UI display
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setLocalCurrentTime(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      if (video.duration && !isNaN(video.duration) && video.duration > 0) {
        setLocalDuration(video.duration);
      }
    };

    const handleWaiting = () => setIsBuffering(true);
    const handlePlaying = () => setIsBuffering(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
    };
  }, [videoRef]);

  // Set initial volume & mute
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted, videoRef]);

  // Controls auto-hide when idle
  const handleMouseMove = () => {
    setIsControlsVisible(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setIsControlsVisible(false);
        setShowSettings(false);
      }
    }, 3200);
  };

  // Play / Pause toggle
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      onPlayAction('pause', video.currentTime);
      video.pause();
    } else {
      onPlayAction('play', video.currentTime);
      video.play().catch(() => {});
    }
  }, [isPlaying, onPlayAction, videoRef]);

  // Seeking via timeline click or drag
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
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
      {subtitlesEnabled && isPlaying && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-lg bg-black/75 backdrop-blur-sm text-yellow-300 font-medium text-sm sm:text-base tracking-wide text-center max-w-[85%] pointer-events-none drop-shadow-md">
          {localCurrentTime < 1470
            ? "We used to look up at the sky and wonder at our place in the stars..."
            : "Now we just look down and worry about our place in the dirt."}
        </div>
      )}

      {/* Buffering Indicator */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
            <span className="text-xs text-purple-200 font-medium tracking-wider uppercase">Buffering Sync...</span>
          </div>
        </div>
      )}

      {/* Center play icon pulse on pause */}
      {!isPlaying && !isBuffering && (
        <div
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/25 group-hover:bg-black/35 transition-colors"
        >
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-purple-600/80 hover:bg-purple-600 text-white flex items-center justify-center backdrop-blur-md shadow-2xl shadow-purple-600/50 hover:scale-110 active:scale-95 transition-all">
            <Play className="w-8 h-8 sm:w-10 sm:h-10 ml-1 fill-white" />
          </div>
        </div>
      )}

      {/* Top Floating Badge: In Sync • 12ms (matching reference image) */}
      <div className="absolute top-4 sm:top-5 left-4 sm:left-6 flex items-center gap-2 bg-[#0c1020]/80 backdrop-blur-md border border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-full text-xs sm:text-sm font-semibold shadow-lg shadow-emerald-950/40 pointer-events-none">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        <span className="text-slate-100">
          In Sync <span className="text-emerald-400">• {latencyMs}ms</span>
        </span>
        <Signal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      </div>

      {/* Top Floating Action: Fullscreen button */}
      <button
        onClick={toggleFullscreen}
        title="Toggle Fullscreen"
        className="absolute top-4 sm:top-5 right-4 sm:right-6 w-9 h-9 rounded-xl bg-[#0c1020]/80 hover:bg-purple-600/80 backdrop-blur-md border border-slate-700/60 text-slate-200 hover:text-white flex items-center justify-center shadow-lg transition-all"
      >
        {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
      </button>

      {/* Bottom Player Controls Overlay */}
      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent pt-12 pb-3.5 px-4 sm:px-6 transition-opacity duration-300 ${
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
