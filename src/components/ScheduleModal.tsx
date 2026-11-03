import React, { useState } from 'react';
import { X, Calendar, Clock, Play, Check, AlertCircle } from 'lucide-react';

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSchedule: string | null;
  onSaveSchedule: (time: string | null, status?: 'scheduled' | 'playing') => void;
  showToast: (text: string, variant?: string) => void;
}

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  isOpen,
  onClose,
  currentSchedule,
  onSaveSchedule,
  showToast,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customDateTime, setCustomDateTime] = useState('');

  if (!isOpen) return null;

  const handleSetInMinutes = (mins: number) => {
    const target = new Date(Date.now() + mins * 60 * 1000);
    onSaveSchedule(target.toISOString(), 'scheduled');
    showToast(`Party scheduled to start in ${mins} minutes!`, 'success');
    onClose();
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDateTime) return;
    const target = new Date(customDateTime);
    onSaveSchedule(target.toISOString(), 'scheduled');
    showToast(`Watch party scheduled for ${target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}!`, 'success');
    onClose();
  };

  const handleStartNow = () => {
    onSaveSchedule(new Date().toISOString(), 'playing');
    showToast('Watch party started right now! Syncing all watchers...', 'success');
    onClose();
  };

  const handleClearSchedule = () => {
    onSaveSchedule(null, 'playing');
    showToast('Schedule cleared - regular playback mode', 'info');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#101426] border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-base sm:text-lg text-white">Schedule Watch Party</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {/* Quick presets */}
          <div>
            <label className="block text-slate-300 font-semibold mb-2">
              Quick Countdown Timers
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[5, 10, 15, 30, 45, 60].map((mins) => (
                <button
                  key={mins}
                  onClick={() => handleSetInMinutes(mins)}
                  className="py-2.5 px-3 bg-[#0c1020] hover:bg-purple-600/30 border border-slate-700 hover:border-purple-500 text-slate-200 hover:text-purple-200 rounded-xl font-medium transition-all text-center flex flex-col items-center gap-0.5"
                >
                  <span className="font-bold text-sm text-white">{mins}m</span>
                  <span className="text-[10px] text-slate-400">Countdown</span>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Date & Time */}
          <form onSubmit={handleCustomSubmit} className="pt-2">
            <label className="block text-slate-300 font-semibold mb-1.5">
              Specific Date & Time
            </label>
            <div className="flex gap-2">
              <input
                type="datetime-local"
                value={customDateTime}
                onChange={(e) => setCustomDateTime(e.target.value)}
                className="flex-1 bg-[#0c1020] border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500 text-xs font-mono"
              />
              <button
                type="submit"
                disabled={!customDateTime}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold rounded-xl shadow transition-all flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Set</span>
              </button>
            </div>
          </form>

          {/* Direct Start Now option (as requested: "یا اینکه یهویی شروع کنیم به دیدنش") */}
          <div className="pt-3 border-t border-slate-800/80 space-y-2">
            <button
              onClick={handleStartNow}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 text-xs"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Start Immediately (شروع یهویی الان)</span>
            </button>

            {currentSchedule && (
              <button
                onClick={handleClearSchedule}
                className="w-full py-2 text-slate-400 hover:text-rose-400 text-xs transition-colors"
              >
                Cancel active schedule
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
