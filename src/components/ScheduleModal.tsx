import React, { useState } from 'react';
import { X, Play, Check } from 'lucide-react';

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSchedule: string | null;
  onSaveSchedule: (time: string | null, status?: 'scheduled' | 'playing') => void;
  showToast: (text: string, variant?: string) => void;
}

export const ScheduleModal: React.FC<ScheduleModalProps> = ({ isOpen, onClose, currentSchedule, onSaveSchedule, showToast }) => {
  const [customDateTime, setCustomDateTime] = useState('');

  if (!isOpen) return null;

  const schedule = (target: Date) => {
    onSaveSchedule(target.toISOString(), 'scheduled');
    showToast(`شروع: ${target.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}`, 'success');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" dir="rtl" onClick={onClose}>
      <div className="bg-[#101426] border border-slate-700/80 rounded-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="font-bold text-white">زمان‌بندی</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-3 gap-2">
            {[5, 10, 15, 30, 45, 60].map((mins) => (
              <button
                key={mins}
                onClick={() => schedule(new Date(Date.now() + mins * 60000))}
                className="py-2.5 bg-[#0c1020] hover:bg-purple-600/30 border border-slate-700 hover:border-purple-500 text-white rounded-xl font-bold"
              >
                {mins.toLocaleString('fa-IR')} دقیقه
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customDateTime) schedule(new Date(customDateTime));
            }}
            className="flex gap-2"
          >
            <input
              type="datetime-local"
              value={customDateTime}
              onChange={(e) => setCustomDateTime(e.target.value)}
              className="flex-1 bg-[#0c1020] border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500 font-mono"
            />
            <button type="submit" disabled={!customDateTime} className="px-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded-xl">
              <Check className="w-4 h-4" />
            </button>
          </form>

          <div className="pt-3 border-t border-slate-800 space-y-2">
            <button
              onClick={() => {
                onSaveSchedule(new Date().toISOString(), 'playing');
                onClose();
              }}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 fill-white" />
              شروع الان
            </button>
            {currentSchedule && (
              <button
                onClick={() => {
                  onSaveSchedule(null, 'playing');
                  onClose();
                }}
                className="w-full py-2 text-slate-400 hover:text-rose-400"
              >
                لغو زمان‌بندی
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
