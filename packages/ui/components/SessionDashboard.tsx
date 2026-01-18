'use client';

import { useSessionStore } from '@/store/useSessionStore';
import { motion } from 'framer-motion';
import { ShieldCheck, Clock, Calendar } from 'lucide-react';

export default function SessionDashboard() {
  const { escrows, sessionId } = useSessionStore();

  if (escrows.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16">
        <div className="text-center text-white/60">
          <ShieldCheck className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg">No escrows yet. Create one above to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-16">
      <div className="mb-8">
        <h3 className="text-2xl font-bold text-white mb-2">Session Activity</h3>
        <p className="text-sm text-white/60 font-mono">Session ID: {sessionId}</p>
      </div>

      <div className="grid gap-4">
        {escrows.map((escrow, index) => (
          <motion.div
            key={escrow.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
            className="bg-white/15 backdrop-blur-xl rounded-xl shadow-md border border-white/30 p-6 hover:shadow-lg hover:border-[#0BB89A]/50 transition-all"
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              {/* Left side - Main info */}
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    escrow.status === 'pending'
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-emerald-500/20 text-emerald-300'
                  }`}>
                    {escrow.status.toUpperCase()}
                  </div>
                  <div className="px-3 py-1 rounded-full text-xs font-semibold bg-[#0BB89A]/20 text-[#0BB89A]">
                    {escrow.amount} USDC
                  </div>
                </div>
                
                <p className="text-white mb-2 font-mono text-xs truncate max-w-[400px]">{escrow.escrowAddress}</p>
                
                <div className="flex flex-col gap-2 text-sm text-white/70">
                  <div className="flex items-center gap-2">
                    <span className="text-white/50 text-xs">Buyer:</span>
                    <span className="font-mono text-xs truncate max-w-[280px]">
                      {escrow.funder}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white/50 text-xs">Seller:</span>
                    <span className="font-mono text-xs truncate max-w-[280px]">
                      {escrow.payout}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-4 h-4 text-[#0BB89A]" />
                      <span>Due: {new Date(escrow.deadline).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      <span>{new Date(escrow.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right side - Actions */}
              <div className="flex gap-2">
                <button className="px-4 py-2 text-sm font-medium text-[#0BB89A] hover:bg-[#0BB89A]/20 rounded-lg transition-colors border border-[#0BB89A]/30">
                  View Details
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

