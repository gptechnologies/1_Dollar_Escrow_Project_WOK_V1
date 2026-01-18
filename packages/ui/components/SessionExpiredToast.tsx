'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, X } from 'lucide-react';

interface SessionExpiredToastProps {
  show: boolean;
  onClose: () => void;
}

export default function SessionExpiredToast({ show, onClose }: SessionExpiredToastProps) {
  useEffect(() => {
    if (show) {
      const timer = setTimeout(() => {
        onClose();
      }, 5000); // Auto-dismiss after 5 seconds

      return () => clearTimeout(timer);
    }
  }, [show, onClose]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -50, scale: 0.95 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-full mx-4"
        >
          <div className="bg-white rounded-xl shadow-2xl border-2 border-red-100 p-4 flex items-start gap-3">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">
                Session Expired
              </h3>
              <p className="text-sm text-gray-600">
                Your session has expired due to inactivity. A new session has been created.
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 p-1 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Close notification"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


