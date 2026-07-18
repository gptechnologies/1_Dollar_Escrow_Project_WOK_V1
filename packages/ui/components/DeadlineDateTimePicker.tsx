'use client';

import { useEffect, useState } from 'react';

interface DeadlineDateTimePickerProps {
  deadline: string;
  setDeadline: (value: string) => void;
  deadlineTime: string;
  setDeadlineTime: (value: string) => void;
  error?: string;
  clearError: () => void;
  label?: string;
  idPrefix?: string;
}

export default function DeadlineDateTimePicker({
  deadline,
  setDeadline,
  deadlineTime,
  setDeadlineTime,
  error,
  clearError,
  label = 'Payout Deadline',
  idPrefix = 'deadline',
}: DeadlineDateTimePickerProps) {
  const [timeDisplay, setTimeDisplay] = useState('');

  useEffect(() => {
    setTimeDisplay(format24hToDisplay(deadlineTime));
  }, [deadlineTime]);

  const inputBaseClasses =
    'w-full px-2.5 py-2 rounded-lg focus:outline-none transition-colors surface-input text-white text-sm placeholder:text-white/50 font-medium';
  const inputNormalClasses =
    'border-white/40 focus:border-[#0BB89A] focus:ring-2 focus:ring-[#0BB89A]/50 focus:bg-white/30';
  const inputErrorClasses = 'border-red-300 focus:border-red-500';

  const formatDateForTyping = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  };

  const parseTimeTo24h = (value: string): string | null => {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return null;

    const direct24hMatch = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (direct24hMatch) {
      const h = direct24hMatch[1].padStart(2, '0');
      const m = direct24hMatch[2];
      return `${h}:${m}`;
    }

    const compact = normalized.replace(/\s+/g, '');
    const twelveHourMatch = compact.match(/^(\d{1,2})(?::?(\d{2}))?(AM|PM)$/);
    if (twelveHourMatch) {
      const hour = Number(twelveHourMatch[1]);
      const minute = Number(twelveHourMatch[2] ?? '0');
      const meridiem = twelveHourMatch[3];
      if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;

      let hour24 = hour % 12;
      if (meridiem === 'PM') hour24 += 12;
      return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    return null;
  };

  function format24hToDisplay(value: string) {
    const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) return value;

    const hour24 = Number(match[1]);
    const minute = match[2];
    const meridiem = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${minute} ${meridiem}`;
  }

  return (
    <div>
      <label
        htmlFor={idPrefix}
        className="block text-xs font-semibold text-white/90 mb-1"
      >
        {label}
      </label>
      <div className="flex gap-2">
        {/* Date Input */}
        <div className="flex-1">
          <input
            type="text"
            id={idPrefix}
            value={deadline}
            onChange={(e) => {
              setDeadline(formatDateForTyping(e.target.value));
              clearError();
            }}
            placeholder="MM/DD/YYYY"
            className={`${inputBaseClasses} ${
              error ? inputErrorClasses : inputNormalClasses
            }`}
            inputMode="numeric"
            autoComplete="off"
            required
          />
        </div>

        {/* Time Input */}
        <div className="w-24">
          <input
            type="text"
            id={`${idPrefix}Time`}
            value={timeDisplay}
            onChange={(e) => {
              setTimeDisplay(e.target.value.toUpperCase());
              clearError();
            }}
            onBlur={() => {
              const parsed = parseTimeTo24h(timeDisplay);
              if (parsed) {
                setDeadlineTime(parsed);
                setTimeDisplay(format24hToDisplay(parsed));
              } else {
                setTimeDisplay(format24hToDisplay(deadlineTime));
              }
            }}
            placeholder="11:59 PM"
            className={`${inputBaseClasses} text-center tracking-wide ${
              error ? inputErrorClasses : inputNormalClasses
            }`}
            inputMode="text"
            autoComplete="off"
            required
          />
        </div>
      </div>

      {error && <p className="mt-0.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}
