'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type DatePickerFieldProps = {
  id?: string;
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  minDate?: Date;
  className?: string;
};

export function dateToEndOfDayTs(date: Date): number {
  const d = new Date(date);
  d.setHours(23, 59, 59, 0);
  return Math.floor(d.getTime() / 1000);
}

export function parseSlashDate(value: string): Date | undefined {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return undefined;
  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return date;
}

export default function DatePickerField({
  id,
  value,
  onChange,
  placeholder = 'Select date',
  disabled = false,
  minDate,
  className,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn('rune-date-trigger', !value && 'rune-date-trigger-empty', className)}
        >
          <CalendarIcon size={15} aria-hidden />
          <span>{value ? format(value, 'MMM d, yyyy') : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="rune-date-popover w-auto p-0" align="start" sideOffset={6}>
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onChange(date);
            if (date) setOpen(false);
          }}
          disabled={
            minDate
              ? (date) => {
                  const floor = new Date(minDate);
                  floor.setHours(0, 0, 0, 0);
                  const candidate = new Date(date);
                  candidate.setHours(0, 0, 0, 0);
                  return candidate < floor;
                }
              : undefined
          }
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
