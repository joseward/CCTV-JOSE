import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon, 
  RefreshCw, 
  CheckCircle,
  Database
} from 'lucide-react';
import type { Camera } from '../types/cctv';
import { queryRecordedDays } from '../services/playback';

interface PlaybackCalendarProps {
  selectedDate: string; // YYYY-MM-DD
  onSelectDate: (dateStr: string) => void;
  activeCamera: Camera | null;
  fullWidth?: boolean;
  buttonClassName?: string;
}

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const WEEKDAY_NAMES = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];

export const PlaybackCalendar: React.FC<PlaybackCalendarProps> = ({
  selectedDate,
  onSelectDate,
  activeCamera,
  fullWidth = false,
  buttonClassName = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Parse current selected date
  const [viewYear, setViewYear] = useState<number>(() => {
    const parts = (selectedDate || '').split('-');
    return parts.length === 3 ? parseInt(parts[0], 10) : new Date().getFullYear();
  });

  const [viewMonth, setViewMonth] = useState<number>(() => {
    const parts = (selectedDate || '').split('-');
    return parts.length === 3 ? parseInt(parts[1], 10) : new Date().getMonth() + 1;
  });

  // Recorded days in the currently viewed month (Set of day numbers 1-31)
  const [recordedDays, setRecordedDays] = useState<Set<number>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string>('');

  // Sync view when selectedDate changes externally
  useEffect(() => {
    if (selectedDate) {
      const parts = selectedDate.split('-');
      if (parts.length === 3) {
        setViewYear(parseInt(parts[0], 10));
        setViewMonth(parseInt(parts[1], 10));
      }
    }
  }, [selectedDate]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Scan DVR for recordings in this month (cached in memory)
  const scanMonthRecordings = async (force: boolean = false) => {
    if (!activeCamera) return;
    setIsScanning(true);
    setScanMessage(`Consultando grabaciones para ${activeCamera.name}...`);
    try {
      const days = await queryRecordedDays(activeCamera, viewYear, viewMonth, force);
      setRecordedDays(new Set(days));
      if (days.length > 0) {
        const minDay = Math.min(...days);
        const maxDay = Math.max(...days);
        setScanMessage(`${days.length} días disponibles (del ${minDay} al ${maxDay})`);

        // If currently selected date has NO recordings for this camera, auto-select latest available day
        const pad = (n: number) => n.toString().padStart(2, '0');
        const selectedParts = (selectedDate || '').split('-');
        const currentSelectedDayNum = selectedParts.length === 3 ? parseInt(selectedParts[2], 10) : 0;

        if (!days.includes(currentSelectedDayNum)) {
          const latestDay = maxDay;
          const newDateStr = `${viewYear}-${pad(viewMonth)}-${pad(latestDay)}`;
          onSelectDate(newDateStr);
        }
      } else {
        setScanMessage('Sin grabaciones detectadas en este mes');
      }
    } catch {
      setScanMessage('No se pudo verificar el historial del disco');
    } finally {
      setIsScanning(false);
    }
  };

  // Trigger scan when camera, year, or month changes
  useEffect(() => {
    if (activeCamera) {
      setRecordedDays(new Set()); // Reset immediately so previous camera days don't leak
      scanMonthRecordings(false);
    }
  }, [activeCamera?.id, activeCamera?.channel, viewYear, viewMonth]);

  // Calendar math
  const daysInMonth = useMemo(() => {
    return new Date(viewYear, viewMonth, 0).getDate();
  }, [viewYear, viewMonth]);

  const firstDayOfWeek = useMemo(() => {
    // 0 = Sunday, 1 = Monday, etc.
    return new Date(viewYear, viewMonth - 1, 1).getDay();
  }, [viewYear, viewMonth]);

  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const newDateStr = `${viewYear}-${pad(viewMonth)}-${pad(day)}`;
    onSelectDate(newDateStr);
    setIsOpen(false);
  };

  const formatButtonLabel = () => {
    if (!selectedDate) return 'Seleccionar Fecha';
    const [y, m, d] = selectedDate.split('-');
    const monthIdx = parseInt(m, 10) - 1;
    return `${d} de ${MONTH_NAMES[monthIdx] || m} ${y}`;
  };

  const selectedParts = (selectedDate || '').split('-');
  const isViewingSelectedMonth =
    selectedParts.length === 3 &&
    parseInt(selectedParts[0], 10) === viewYear &&
    parseInt(selectedParts[1], 10) === viewMonth;
  const selectedDayNum = isViewingSelectedMonth ? parseInt(selectedParts[2], 10) : -1;

  const today = new Date();
  const isTodayMonth =
    today.getFullYear() === viewYear && today.getMonth() + 1 === viewMonth;
  const todayDay = isTodayMonth ? today.getDate() : -1;

  return (
    <div className={`relative ${fullWidth ? 'w-full' : 'inline-block'}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`${fullWidth ? 'w-full justify-between' : 'inline-flex'} flex items-center space-x-2 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-purple-500 rounded-lg text-white font-mono text-xs shadow-inner transition group ${buttonClassName}`}
        title="Abrir calendario con días grabados resaltados"
      >
        <div className="flex items-center space-x-2">
          <CalendarIcon className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
          <span className="font-semibold text-slate-200">{formatButtonLabel()}</span>
        </div>
        {recordedDays.size > 0 && (
          <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-emerald-950/90 border border-emerald-500/50 text-emerald-400 text-[10px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>{recordedDays.size}d</span>
          </span>
        )}
      </button>

      {/* Popover Calendar Modal */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 z-50 w-72 bg-slate-950/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-3.5 text-xs text-white select-none animate-in fade-in zoom-in-95 duration-150">
          {/* Header: Month / Year + Controls */}
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-800/80">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition"
              title="Mes anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-1.5 font-bold tracking-wide">
              <span className="text-purple-300 font-semibold">{MONTH_NAMES[viewMonth - 1]}</span>
              <span className="text-white">{viewYear}</span>
            </div>

            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => scanMonthRecordings(true)}
                disabled={isScanning}
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-emerald-400 rounded-lg transition"
                title="Actualizar detección de grabaciones"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-emerald-400' : ''}`} />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition"
                title="Mes siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Weekday Labels */}
          <div className="grid grid-cols-7 gap-1 text-center py-2 text-[10px] font-mono font-bold text-slate-500">
            {WEEKDAY_NAMES.map((name) => (
              <div key={name}>{name}</div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {/* Empty slots before first day */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="h-8" />
            ))}

            {/* Month Days */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const hasRecording = recordedDays.has(day);
              const isSelected = day === selectedDayNum;
              const isToday = day === todayDay;

              return (
                <button
                  key={`day-${day}`}
                  type="button"
                  onClick={() => handleSelectDay(day)}
                  className={`h-8 w-8 mx-auto rounded-xl flex flex-col items-center justify-center relative font-mono text-[11px] transition-all group ${
                    isSelected
                      ? 'bg-purple-600 text-white font-extrabold shadow-[0_0_12px_rgba(168,85,247,0.5)] ring-2 ring-purple-400 scale-105'
                      : hasRecording
                      ? 'bg-emerald-950/80 border border-emerald-500/70 text-emerald-200 font-bold hover:bg-emerald-800 hover:scale-105 shadow-sm'
                      : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                  }`}
                  title={
                    hasRecording
                      ? `Día ${day}: Grabación detectada en disco duro`
                      : `Día ${day}: Sin grabación detectada`
                  }
                >
                  <span className={isToday && !isSelected ? 'underline decoration-purple-400 decoration-2 font-bold' : ''}>
                    {day}
                  </span>

                  {/* Dot indicator for recordings */}
                  {hasRecording && !isSelected && (
                    <span className="w-1 h-1 rounded-full bg-emerald-400 -mt-0.5 shadow-[0_0_4px_#34d399]" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Scan Status / Recording Count Pill */}
          <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
            <div className="flex items-center space-x-1.5 truncate text-slate-400">
              <Database className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
              <span className="truncate">{scanMessage || 'Comprobando grabaciones...'}</span>
            </div>
            {recordedDays.size > 0 && (
              <div className="flex items-center space-x-1 text-emerald-400 font-semibold flex-shrink-0">
                <CheckCircle className="w-3 h-3" />
                <span>{recordedDays.size}d</span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="mt-2 pt-1.5 border-t border-slate-900 flex items-center justify-center space-x-3 text-[9px] text-slate-400 font-medium">
            <div className="flex items-center space-x-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_4px_#10b981]" />
              <span>Con Video</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="w-2 h-2 rounded-full bg-slate-700" />
              <span>Sin Video</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_4px_#a855f7]" />
              <span>Seleccionado</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
