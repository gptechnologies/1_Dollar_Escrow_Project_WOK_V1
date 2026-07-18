'use client';

import { CircleHelp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type FieldHelpPopoverProps = {
  label: string;
  description: string;
};

export default function FieldHelpPopover({ label, description }: FieldHelpPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rune-field-help-trigger"
          aria-label={`Help: ${label}`}
        >
          <CircleHelp size={14} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="rune-field-help"
        side="top"
        align="start"
        sideOffset={8}
        avoidCollisions={false}
      >
        <p className="rune-field-help-title">{label}</p>
        <p className="rune-field-help-body">{description}</p>
      </PopoverContent>
    </Popover>
  );
}
