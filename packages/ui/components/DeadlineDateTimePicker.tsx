'use client';

import { Input } from '@/components/ui/input';

interface DeadlineDateTimePickerProps {
  deadline: string;
  setDeadline: (value: string) => void;
  deadlineTime: string;
  setDeadlineTime: (value: string) => void;
  error?: string;
  clearError: () => void;
}

export default function DeadlineDateTimePicker({
  deadline,
  setDeadline,
  deadlineTime,
  setDeadlineTime,
  error,
  clearError,
}: DeadlineDateTimePickerProps) {
  const inputBaseClasses =
    'w-full px-2.5 py-2 rounded-lg focus:outline-none transition-colors surface-input text-white text-sm placeholder:text-white/50';
  const inputNormalClasses =
    'border-white/40 focus:border-[#0BB89A] focus:ring-2 focus:ring-[#0BB89A]/50 focus:bg-white/30';
  const inputErrorClasses = 'border-red-300 focus:border-red-500';

  return (
    <div>
      <label
        htmlFor="deadline"
        className="block text-xs font-semibold text-white/90 mb-1"
      >
        Payout Deadline
      </label>
      <div className="flex gap-2">
        {/* Date Input */}
        <div className="flex-1">
          <input
            type="text"
            id="deadline"
            value={deadline}
            onChange={(e) => {
              setDeadline(e.target.value);
              clearError();
            }}
            placeholder="MM/DD/YY"
            className={`${inputBaseClasses} ${
              error ? inputErrorClasses : inputNormalClasses
            }`}
            required
          />
        </div>

        {/* Time Input */}
        <div className="w-24">
          <Input
            type="time"
            id="deadlineTime"
            step="60"
            value={deadlineTime}
            onChange={(e) => {
              setDeadlineTime(e.target.value);
              clearError();
            }}
            className="w-full px-2 py-2 h-auto rounded-lg focus:outline-none transition-colors surface-input text-white text-sm border-white/40 focus:border-[#0BB89A] focus:ring-2 focus:ring-[#0BB89A]/50 focus:bg-white/30 shadow-none appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            required
          />
        </div>
      </div>

      {error && <p className="mt-0.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}
