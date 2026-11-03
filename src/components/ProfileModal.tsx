import React, { useEffect, useState } from 'react';
import { X, Check, LogOut } from 'lucide-react';

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

const COLORS = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  currentName,
  currentColor,
  username,
  role,
  onSaveProfile,
  onLogout,
}) => {
  const [name, setName] = useState(currentName);
  const [color, setColor] = useState(currentColor);

  useEffect(() => {
    if (isOpen) {
      setName(currentName);
      setColor(currentColor);
    }
  }, [isOpen, currentName, currentColor]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" dir="rtl" onClick={onClose}>
      <div className="bg-[#101426] border border-slate-700/80 rounded-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h3 className="font-bold text-white">پروفایل</h3>
            {username && (
              <span className="text-[11px] text-slate-400" dir="ltr">
                @{username}
                {role === 'admin' && ' · admin'}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            onSaveProfile(name.trim(), color);
            onClose();
          }}
          className="p-5 space-y-4 text-xs"
        >
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="نام نمایشی"
            className="w-full bg-[#0c1020] border border-slate-700 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />

          <div className="flex gap-2.5 justify-center">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:scale-110 transition-transform"
                style={{ backgroundColor: c }}
              >
                {color === c && <Check className="w-4 h-4 text-white stroke-[3]" />}
              </button>
            ))}
          </div>

          <button type="submit" className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl">
            ذخیره
          </button>
          {onLogout && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onLogout();
              }}
              className="w-full py-2 text-rose-300 hover:bg-rose-500/10 rounded-xl flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              خروج
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
