'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

interface AccordionItem {
  id: string;
  title: string;
  content: React.ReactNode;
  mobileOnly?: boolean;
}

interface InfoAccordionProps {
  items: AccordionItem[];
}

export default function InfoAccordion({ items }: InfoAccordionProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  const toggleItem = (id: string) => {
    setOpenId(openId === id ? null : id);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleItem(id);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {items.map((item) => {
        const isOpen = openId === item.id;
        // Apply responsive visibility class based on mobileOnly flag
        const visibilityClass = item.mobileOnly ? 'md:hidden' : '';
        return (
          <div
            key={item.id}
            className={`surface-card overflow-hidden ${visibilityClass}`}
          >
            {/* Header */}
            <button
              type="button"
              onClick={() => toggleItem(item.id)}
              onKeyDown={(e) => handleKeyDown(e, item.id)}
              className="w-full flex items-center justify-between p-5 text-left hover:bg-white/5 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0BB89A]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#222222]"
              aria-expanded={isOpen}
              aria-controls={`content-${item.id}`}
            >
              <h3 className="text-lg font-semibold text-white pr-4">{item.title}</h3>
              <ChevronDown
                className={`h-5 w-5 text-white/60 flex-shrink-0 transition-transform duration-200 ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Content */}
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  id={`content-${item.id}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 text-white/70 text-sm leading-relaxed">
                    {item.content}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

