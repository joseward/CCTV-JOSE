import React from 'react';
import { Clock } from 'lucide-react';

interface QuickOffset {
  label: string;
  sec: number;
}

interface Time24InputProps {
  label: string;
  value: string; // "HH:MM:SS" (24h)
  onChange: (newTime: string) => void;
  onCopyPlayerTime?: () => void;
  quickOffsets?: QuickOffset[];
  onSetFromStart?: (offsetSec: number) => void;
}

export const Time24Input: React.FC<Time24InputProps> = ({
  label,
  value,
  onChange,
  onCopyPlayerTime,
  quickOffsets,
  onSetFromStart,
}) => {
  const [hStr, mStr, sStr] = (value || '00:00:00').split(':');
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;
  const s = parseInt(sStr, 10) || 0;

  const pad = (n: number) => n.toString().padStart(2, '0');

  const update = (newH: number, newM: number, newS: number) => {
    const clampedH = Math.max(0, Math.min(23, isNaN(newH) ? 0 : newH));
    const clampedM = Math.max(0, Math.min(59, isNaN(newM) ? 0 : newM));
    const clampedS = Math.max(0, Math.min(59, isNaN(newS) ? 0 : newS));
    onChange(`${pad(clampedH)}:${pad(clampedM)}:${pad(clampedS)}`);
  };

  const handleApplyOffset = (deltaSec: number) => {
    const currentSec = h * 3600 + m * 60 + s;
    const targetSec = Math.max(0, Math.min(86399, currentSec + deltaSec));
    const nextH = Math.floor(targetSec / 3600);
    const nextM = Math.floor((targetSec % 3600) / 60);
    const nextS = Math.floor(targetSec % 60);
    onChange(`${pad(nextH)}:${pad(nextM)}:${pad(nextS)}`);
  };

  return (
    <div className="bg-slate-900 border border-slate-700/80 rounded-xl p-3 space-y-2.5 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
        <span className="flex items-center space-x-1.5">
          <Clock className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
          <span>{label}</span>
        </span>
        <span className="text-[10px] font-mono text-purple-300 bg-purple-950/60 border border-purple-800/60 px-1.5 py-0.5 rounded">
          24 Horas
        </span>
      </div>

      {/* 24-Hour Number Spinners: [HH] : [MM] : [SS] */}
      <div className="flex items-center justify-center space-x-1 font-mono text-center select-none bg-slate-950/60 border border-slate-800 rounded-lg py-1.5 px-2">
        {/* Hours */}
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => update((h + 1) % 24, m, s)}
            className="text-slate-400 hover:text-white px-2 py-0.5 text-[10px] hover:bg-slate-800 rounded transition"
            title="Aumentar hora (+1h)"
          >
            ▲
          </button>
          <input
            type="number"
            min={0}
            max={23}
            value={pad(h)}
            onChange={(e) => update(parseInt(e.target.value, 10), m, s)}
            className="w-11 text-center bg-slate-900 border border-slate-700 rounded-md py-1 text-sm font-bold text-white focus:outline-none focus:border-purple-500"
          />
          <button
            type="button"
            onClick={() => update((h - 1 + 24) % 24, m, s)}
            className="text-slate-400 hover:text-white px-2 py-0.5 text-[10px] hover:bg-slate-800 rounded transition"
            title="Disminuir hora (-1h)"
          >
            ▼
          </button>
          <span className="text-[9px] text-slate-500 font-semibold tracking-wider">HH</span>
        </div>

        <span className="text-purple-400 font-bold text-base pb-3.5">:</span>

        {/* Minutes */}
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => update(h, (m + 1) % 60, s)}
            className="text-slate-400 hover:text-white px-2 py-0.5 text-[10px] hover:bg-slate-800 rounded transition"
            title="Aumentar minutos (+1m)"
          >
            ▲
          </button>
          <input
            type="number"
            min={0}
            max={59}
            value={pad(m)}
            onChange={(e) => update(h, parseInt(e.target.value, 10), s)}
            className="w-11 text-center bg-slate-900 border border-slate-700 rounded-md py-1 text-sm font-bold text-white focus:outline-none focus:border-purple-500"
          />
          <button
            type="button"
            onClick={() => update(h, (m - 1 + 60) % 60, s)}
            className="text-slate-400 hover:text-white px-2 py-0.5 text-[10px] hover:bg-slate-800 rounded transition"
            title="Disminuir minutos (-1m)"
          >
            ▼
          </button>
          <span className="text-[9px] text-slate-500 font-semibold tracking-wider">MM</span>
        </div>

        <span className="text-purple-400 font-bold text-base pb-3.5">:</span>

        {/* Seconds */}
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => update(h, m, (s + 5) % 60)}
            className="text-slate-400 hover:text-white px-2 py-0.5 text-[10px] hover:bg-slate-800 rounded transition"
            title="Aumentar segundos (+5s)"
          >
            ▲
          </button>
          <input
            type="number"
            min={0}
            max={59}
            value={pad(s)}
            onChange={(e) => update(h, m, parseInt(e.target.value, 10))}
            className="w-11 text-center bg-slate-900 border border-slate-700 rounded-md py-1 text-sm font-bold text-white focus:outline-none focus:border-purple-500"
          />
          <button
            type="button"
            onClick={() => update(h, m, (s - 5 + 60) % 60)}
            className="text-slate-400 hover:text-white px-2 py-0.5 text-[10px] hover:bg-slate-800 rounded transition"
            title="Disminuir segundos (-5s)"
          >
            ▼
          </button>
          <span className="text-[9px] text-slate-500 font-semibold tracking-wider">SS</span>
        </div>
      </div>

      {/* Quick Adjustment Chips */}
      <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono pt-0.5">
        {onCopyPlayerTime && (
          <button
            type="button"
            onClick={onCopyPlayerTime}
            className="w-full text-center py-1 px-2 rounded-lg bg-purple-950/40 hover:bg-purple-900/60 border border-purple-800/60 text-purple-300 font-semibold transition"
          >
            🎯 Usar hora del reproductor
          </button>
        )}

        {quickOffsets && quickOffsets.map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => handleApplyOffset(opt.sec)}
            className="flex-1 min-w-[36px] py-0.5 px-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-600 rounded text-slate-400 hover:text-white text-center transition"
          >
            {opt.label}
          </button>
        ))}

        {onSetFromStart && (
          <div className="w-full flex items-center gap-1 pt-1">
            <span className="text-[9px] text-slate-400 font-sans mr-0.5">Duración:</span>
            {[
              { label: '+5m', sec: 300 },
              { label: '+10m', sec: 600 },
              { label: '+15m', sec: 900 },
              { label: '+30m', sec: 1800 },
              { label: '+1h', sec: 3600 },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => onSetFromStart(p.sec)}
                className="flex-1 py-0.5 px-1 bg-purple-950/40 hover:bg-purple-900/60 border border-purple-800/50 rounded text-purple-300 hover:text-white font-bold text-center transition"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
