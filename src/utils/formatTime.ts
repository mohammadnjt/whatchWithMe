export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const totalSeconds = Math.floor(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/** Relative time such as "5m ago" (en) or "۵ دقیقه پیش" (fa); null/0 means never. */
export function timeAgo(ms: number | null | undefined, lang: 'en' | 'fa' = 'en'): string {
  const fa = lang === 'fa';
  if (!ms) return fa ? 'هرگز' : 'never';
  const mins = Math.floor((Date.now() - ms) / 60000);
  const n = (v: number) => (fa ? v.toLocaleString('fa-IR') : String(v));
  if (mins < 1) return fa ? 'همین الان' : 'just now';
  if (mins < 60) return fa ? `${n(mins)} دقیقه پیش` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return fa ? `${n(hours)} ساعت پیش` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return fa ? `${n(days)} روز پیش` : `${days}d ago`;
  return new Date(ms).toLocaleDateString(fa ? 'fa-IR' : undefined);
}
