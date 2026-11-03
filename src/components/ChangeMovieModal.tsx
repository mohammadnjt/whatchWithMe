import React, { useState } from 'react';
import { X, Upload, Link2, Film, Check, AlertCircle, Sparkles, Loader2, Activity } from 'lucide-react';
import { MovieInfo } from '../types';

interface ChangeMovieModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMovie: MovieInfo;
  onSaveMovie: (movie: Partial<MovieInfo>) => void;
  showToast: (text: string, variant?: string) => void;
}

const PRESET_MOVIES: MovieInfo[] = [
  {
    title: 'Interstellar (Tears of Steel Cut)',
    year: '2014',
    genre: 'Sci-Fi, Drama',
    tagline: 'Mankind was born on Earth. It was never meant to die here.',
    posterUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=800&auto=format&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    duration: 8910,
    qualities: [
      { label: '4K', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4' },
      { label: '1080p', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4' },
      { label: '720p', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
      { label: '480p', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4' },
    ],
  },
  {
    title: 'Big Buck Bunny (4K Remaster)',
    year: '2008',
    genre: 'Animation, Comedy',
    tagline: 'A large and lovable rabbit takes on the forest bullies.',
    posterUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=800&auto=format&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    duration: 596,
  },
  {
    title: 'Sintel - The Dragon Quest',
    year: '2010',
    genre: 'Fantasy, Adventure',
    tagline: 'A lonely young woman searches the snowy mountains for a baby dragon.',
    posterUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=800&auto=format&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    duration: 888,
  },
  {
    title: 'Cosmos: Deep Space Odyssey',
    year: '2024',
    genre: 'Documentary, Sci-Fi',
    tagline: 'Voyage through uncharted nebulas and the edge of the universe.',
    posterUrl: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?q=80&w=800&auto=format&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    duration: 90,
  },
];

export const ChangeMovieModal: React.FC<ChangeMovieModalProps> = ({
  isOpen,
  onClose,
  currentMovie,
  onSaveMovie,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<'url' | 'upload' | 'presets'>('url');
  const [videoUrl, setVideoUrl] = useState(currentMovie.videoUrl || '');
  const [title, setTitle] = useState(currentMovie.title || '');
  const [genre, setGenre] = useState(currentMovie.genre || '');
  const [year, setYear] = useState(currentMovie.year || '2026');
  const [tagline, setTagline] = useState(currentMovie.tagline || '');
  const [posterUrl, setPosterUrl] = useState(currentMovie.posterUrl || '');

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [isTestingUrl, setIsTestingUrl] = useState(false);
  const [urlTestResult, setUrlTestResult] = useState<any>(null);

  if (!isOpen) return null;

  const handleTestUrl = async () => {
    if (!videoUrl.trim()) {
      showToast('لطفاً ابتدا لینک ویدیو را وارد کنید.', 'warning');
      return;
    }

    setIsTestingUrl(true);
    setUrlTestResult(null);

    try {
      const res = await fetch('/api/check-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoUrl.trim() }),
      });
      const data = await res.json();
      setUrlTestResult(data);
      if (data.success) {
        showToast('لینک فعال و قابل اتصال است.', 'success');
      } else {
        showToast(`هشدار سرور: ${data.message}`, 'warning');
      }
    } catch (err: any) {
      setUrlTestResult({
        success: false,
        statusCode: 0,
        message: `عدم برقراری تماس تستی: ${err.message}`,
      });
      showToast('خطا در تست اتصال به لینک.', 'warning');
    } finally {
      setIsTestingUrl(false);
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoUrl.trim()) {
      showToast('Please enter a valid video URL', 'warning');
      return;
    }

    onSaveMovie({
      title: title.trim() || 'Custom Video Stream',
      videoUrl: videoUrl.trim(),
      genre: genre.trim() || 'Cinema',
      year: year.trim() || '2026',
      tagline: tagline.trim() || 'Synchronized live party video.',
      posterUrl:
        posterUrl.trim() ||
        'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=800&auto=format&fit=crop',
    });
    showToast('Movie source updated for everyone!', 'success');
    onClose();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check type
    if (!file.type.startsWith('video/')) {
      showToast('Please select a valid video file (.mp4, .webm, .mkv)', 'warning');
      return;
    }

    setUploading(true);
    setUploadProgress(15);

    try {
      const formData = new FormData();
      formData.append('video', file);

      // Perform upload to Express server backend
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setUploadProgress(100);

      const uploadedTitle = file.name.replace(/\.[^/.]+$/, '');
      onSaveMovie({
        title: title || uploadedTitle,
        videoUrl: data.url,
        genre: 'Uploaded Video',
        year: new Date().getFullYear().toString(),
        tagline: `Uploaded movie: ${file.name} (${Math.round(file.size / (1024 * 1024))}MB)`,
        posterUrl:
          posterUrl ||
          'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=800&auto=format&fit=crop',
      });

      showToast('Video uploaded and loaded for everyone!', 'success');
      onClose();
    } catch (err) {
      console.error(err);
      // Fallback: create local object URL so user can still test directly
      const localBlobUrl = URL.createObjectURL(file);
      onSaveMovie({
        title: title || file.name,
        videoUrl: localBlobUrl,
        genre: 'Local Video',
        year: '2026',
        tagline: `Local file: ${file.name}`,
      });
      showToast('Loaded video locally!', 'info');
      onClose();
    } finally {
      setUploading(false);
    }
  };

  const handleSelectPreset = (preset: MovieInfo) => {
    onSaveMovie(preset);
    showToast(`Loaded "${preset.title}"`, 'success');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#101426] border border-slate-700/80 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
              <Film className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-lg text-white">Change or Upload Movie</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 px-5 bg-[#0c0f1d]">
          <button
            onClick={() => setActiveTab('url')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'url'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Link2 className="w-4 h-4" />
            <span>Video URL</span>
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'upload'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Upload File</span>
          </button>
          <button
            onClick={() => setActiveTab('presets')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'presets'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Curated Library</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {activeTab === 'url' && (
            <form onSubmit={handleUrlSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Video Direct URL (MP4, WebM, Stream) *
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    required
                    placeholder="https://example.com/movie.mp4"
                    value={videoUrl}
                    onChange={(e) => {
                      setVideoUrl(e.target.value);
                      setUrlTestResult(null);
                    }}
                    className="flex-1 bg-[#0c1020] border border-slate-700 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleTestUrl}
                    disabled={isTestingUrl || !videoUrl.trim()}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-slate-700 disabled:opacity-50 transition-colors"
                  >
                    <Activity className={`w-3.5 h-3.5 ${isTestingUrl ? 'animate-spin text-purple-400' : 'text-slate-400'}`} />
                    <span>{isTestingUrl ? 'در حال بررسی...' : 'بررسی لینک'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  لینک مستقیم ویدیو با فرمت‌های MP4، WebM یا MKV (با قابلیت استریم مستقیم یا پروکسی سرور)
                </p>

                {urlTestResult && (
                  <div
                    className={`mt-2 p-2.5 rounded-xl border text-xs flex flex-col gap-1 ${
                      urlTestResult.success
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                        : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span>نتیجه بررسی زنده سرور:</span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/40">
                        HTTP {urlTestResult.statusCode || 'Failed'}
                      </span>
                    </div>
                    <p className="text-[11px]">{urlTestResult.message}</p>
                    {!urlTestResult.success && videoUrl && !videoUrl.includes('/api/proxy-stream') && (
                      <button
                        type="button"
                        onClick={() => {
                          const proxied = `/api/proxy-stream?url=${encodeURIComponent(videoUrl.trim())}`;
                          setVideoUrl(proxied);
                          setUrlTestResult(null);
                          showToast('لینک روی حالت پروکسی سرور تنظیم شد.', 'info');
                        }}
                        className="mt-1 self-start px-2 py-1 bg-purple-600/40 hover:bg-purple-600/60 border border-purple-500/50 rounded-lg text-[11px] text-purple-200 font-semibold transition-colors"
                      >
                        ⚡ تبدیل به لینک استریم پروکسی سرور WatchTogether
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Movie Title</label>
                  <input
                    type="text"
                    placeholder="e.g. Interstellar"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-[#0c1020] border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Year & Genre</label>
                  <input
                    type="text"
                    placeholder="2026 • Sci-Fi"
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="w-full bg-[#0c1020] border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Tagline or Description</label>
                <input
                  type="text"
                  placeholder="A short punchy quote or description"
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  className="w-full bg-[#0c1020] border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Poster Image URL (Optional)</label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/..."
                  value={posterUrl}
                  onChange={(e) => setPosterUrl(e.target.value)}
                  className="w-full bg-[#0c1020] border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono text-xs"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl shadow-lg shadow-purple-600/30 transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <Check className="w-4 h-4" />
                  <span>Update Movie in Room</span>
                </button>
              </div>
            </form>
          )}

          {activeTab === 'upload' && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-slate-700 hover:border-purple-500/60 rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-[#0c1020]/50 transition-colors relative group">
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <div className="w-14 h-14 rounded-2xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                  {uploading ? (
                    <Loader2 className="w-7 h-7 animate-spin text-purple-400" />
                  ) : (
                    <Upload className="w-7 h-7" />
                  )}
                </div>
                <h4 className="font-bold text-white text-sm sm:text-base">
                  {uploading ? 'Uploading Video to Server...' : 'Click or Drag & Drop Video File'}
                </h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Upload MP4, WebM, or MKV. The server handles fast range-stream seeking for smooth synchronized playback.
                </p>

                {uploading && (
                  <div className="w-full max-w-xs mt-4">
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-purple-300 font-mono mt-1 block">
                      Uploading: {uploadProgress}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'presets' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PRESET_MOVIES.map((m) => (
                <div
                  key={m.title}
                  onClick={() => handleSelectPreset(m)}
                  className="p-3 bg-[#0c1020] hover:bg-slate-800/80 border border-slate-800 hover:border-purple-500/50 rounded-xl cursor-pointer transition-all flex gap-3 group"
                >
                  <img
                    src={m.posterUrl}
                    alt={m.title}
                    className="w-14 h-20 object-cover rounded-lg shrink-0 border border-slate-700"
                  />
                  <div className="min-w-0 flex-1 flex flex-col justify-center">
                    <h5 className="font-bold text-white text-xs truncate group-hover:text-purple-300">
                      {m.title}
                    </h5>
                    <span className="text-[10px] text-slate-400">{m.genre}</span>
                    <span className="text-[10px] text-purple-400 font-mono mt-1">
                      {Math.floor(m.duration / 60)} mins
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
