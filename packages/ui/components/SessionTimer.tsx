'use client';

import { useEffect, useState } from 'react';
import { useSessionStore } from '@/store/useSessionStore';
import { Clock, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

export default function SessionTimer() {
  const { expiryTime, resetSession } = useSessionStore();
  const [timeLeft, setTimeLeft] = useState(0);
  const [isWarning, setIsWarning] = useState(false);

  useEffect(() => {
    const updateTimer = () => {
      const remaining = Math.max(0, expiryTime - Date.now());
      setTimeLeft(remaining);

      // Show warning when less than 1 minute left
      setIsWarning(remaining > 0 && remaining < 60000);

      // If time expired, reset the session
      if (remaining === 0) {
        resetSession();
      }
    };

    // Update immediately
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [expiryTime, resetSession]);

  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);

  return (
    <motion.div
      animate={isWarning ? { scale: [1, 1.05, 1] } : { scale: 1 }}
      transition={{ duration: 1, repeat: isWarning ? Infinity : 0 }}
      className={`flex items-center gap-2 backdrop-blur-sm px-4 py-2 rounded-xl border transition-colors ${
        isWarning
          ? 'bg-red-50/50 border-red-200/50'
          : 'bg-white/30 border-white/20'
      }`}
    >
      {isWarning ? (
        <AlertCircle className="w-4 h-4 text-red-400" />
      ) : (
        <Clock className="w-4 h-4 text-[#0BB89A]" />
      )}
      <span
        className={`text-sm font-semibold tabular-nums ${
          isWarning ? 'text-red-400' : 'text-white'
        }`}
      >
        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </span>
    </motion.div>
  );
}

