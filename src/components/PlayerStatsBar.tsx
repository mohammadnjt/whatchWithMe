import React from 'react';
import { Users, PlayCircle, Zap } from 'lucide-react';

interface PlayerStatsBarProps {
  viewerCount: number;
  latencyMs: number;
  isAutoSyncActive: boolean;
  isPlaying: boolean;
}

export const PlayerStatsBar: React.FC<PlayerStatsBarProps> = ({
  viewerCount,
  latencyMs,
  isAutoSyncActive = true,
  isPlaying,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-4 sm:mt-6">
      {/* Card 1: Watching Together */}
      <div className="bg-[#12162a]/80 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 flex items-center gap-3.5 shadow-lg">
        <div className="w-11 h-11 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/20 flex items-center justify-center shrink-0">
          <Users className="w-6 h-6" />
        </div>
        <div>
          <div className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-none">
            {viewerCount}
          </div>
          <div className="text-xs text-slate-400 mt-1 font-medium">
            Watching Together
          </div>
        </div>
      </div>

      {/* Card 2: Sync Delay */}
      <div className="bg-[#12162a]/80 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 flex items-center gap-3.5 shadow-lg">
        <div className="w-11 h-11 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 flex items-center justify-center shrink-0">
          <PlayCircle className="w-6 h-6" />
        </div>
        <div>
          <div className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-none font-mono">
            {latencyMs}ms
          </div>
          <div className="text-xs text-slate-400 mt-1 font-medium">
            Sync Delay
          </div>
        </div>
      </div>

      {/* Card 3: Auto Sync Active */}
      <div className="bg-[#12162a]/80 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 flex items-center gap-3.5 shadow-lg">
        <div className="w-11 h-11 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0">
          <Zap className="w-6 h-6" />
        </div>
        <div>
          <div className="text-sm sm:text-base font-bold text-white tracking-tight leading-none">
            Auto Sync
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-1 font-semibold">
            <span>{isAutoSyncActive ? 'Active' : 'Standby'}</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" />
          </div>
        </div>
      </div>

      {/* Card 4: Audio Waveform Visualizer */}
      <div className="bg-[#12162a]/80 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 flex items-center justify-center shadow-lg overflow-hidden">
        <div className="flex items-center gap-1 h-8 w-full justify-center">
          {[
            { height: '35%', delay: '0ms' },
            { height: '65%', delay: '120ms' },
            { height: '85%', delay: '240ms' },
            { height: '40%', delay: '90ms' },
            { height: '100%', delay: '300ms' },
            { height: '50%', delay: '150ms' },
            { height: '75%', delay: '220ms' },
            { height: '30%', delay: '80ms' },
            { height: '90%', delay: '270ms' },
            { height: '60%', delay: '140ms' },
            { height: '45%', delay: '110ms' },
            { height: '80%', delay: '250ms' },
            { height: '25%', delay: '60ms' },
            { height: '70%', delay: '190ms' },
            { height: '40%', delay: '130ms' },
          ].map((bar, i) => (
            <div
              key={i}
              className={`w-1 rounded-full bg-gradient-to-t from-indigo-500 via-purple-500 to-cyan-400 transition-all duration-300 ${
                isPlaying ? 'animate-pulse' : 'opacity-40'
              }`}
              style={{
                height: isPlaying ? bar.height : '20%',
                animationDelay: bar.delay,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
