import React, { useState } from 'react';
import { X, User, Check, LogOut, ShieldCheck } from 'lucide-react';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentName: string;
  currentColor: string;
  username?: string;
  role?: 'admin' | 'user';
  onSaveProfile: (name: string, color: string) => void;
  onLogout?: () => void;
  showToast: (text: string, variant?: string) => void;
}

const COLORS = [
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
];

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  currentName,
  currentColor,
  username,
  role,
  onSaveProfile,
  onLogout,
  showToast,
}) => {
  const [name, setName] = useState(currentName);
  const [color, setColor] = useState(currentColor);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSaveProfile(name.trim(), color);
    showToast('Profile updated!', 'success');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#101426] border border-slate-700/80 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-base sm:text-lg text-white">Your Profile</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {username && (
            <div className="p-3 rounded-xl bg-[#0c1020] border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-slate-400 block text-[10px]">Username</span>
                <span className="font-mono text-slate-200 font-semibold">@{username}</span>
              </div>
              <div className="flex items-center gap-1">
                {role === 'admin' ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Admin</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[10px] font-medium">
                    Member
                  </span>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-slate-300 font-semibold mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mohammad"
              className="w-full bg-[#0c1020] border border-slate-700 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-2">
              Avatar Color
            </label>
            <div className="flex gap-2.5 justify-center py-2">
              {COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 relative"
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Check className="w-4 h-4 text-white stroke-[3]" />}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl shadow-lg shadow-purple-600/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Save Changes</span>
            </button>

            {onLogout && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                className="w-full py-2 px-4 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-medium rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>خروج از حساب کاربری (Logout)</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
