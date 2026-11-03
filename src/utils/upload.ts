import { FilmItem } from '../types';

export interface UploadResult {
  url: string;
  title: string;
}

/** Uploads a video to the server's films, reporting progress from 0 to 100. */
export function uploadVideo(file: File, onProgress?: (percent: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('video', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON error page
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.url) {
        resolve({ url: data.url, title: data.title || file.name.replace(/\.[^/.]+$/, '') });
      } else {
        reject(new Error(data.error || 'آپلود ناموفق بود.'));
      }
    };
    xhr.onerror = () => reject(new Error('ارتباط با سرور قطع شد.'));
    xhr.send(form);
  });
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mkv|webm|avi|mov)$/i.test(file.name);
}

export async function fetchFilms(): Promise<FilmItem[]> {
  const res = await fetch('/api/films');
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
