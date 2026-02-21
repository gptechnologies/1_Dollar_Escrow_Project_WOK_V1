'use client';

import { useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import { Check, Copy, QrCode, Share2, X } from 'lucide-react';
import type { WalletTarget } from '@/lib/share';

type ShareModalProps = {
  shareUrl: string;
  /** Pre-built wallet-specific URLs keyed by target. Falls back to shareUrl for missing keys. */
  walletUrls?: Partial<Record<WalletTarget, string>>;
  title: string;
  description?: string;
  triggerLabel?: string;
  triggerClassName?: string;
};

const WALLET_TABS: { key: WalletTarget; label: string; accent: string }[] = [
  { key: 'web', label: 'Web', accent: 'bg-white/15' },
  { key: 'metamask', label: 'MetaMask', accent: 'bg-[#F6851B]/20' },
  { key: 'coinbase', label: 'Coinbase', accent: 'bg-[#0052FF]/20' },
];

export default function ShareModal({
  shareUrl,
  walletUrls,
  title,
  description,
  triggerLabel = 'Share',
  triggerClassName,
}: ShareModalProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<WalletTarget>('metamask');

  const canNativeShare = useMemo(
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    [],
  );

  const activeUrl = walletUrls?.[selectedWallet] ?? shareUrl;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard failures
    }
  };

  const handleNativeShare = async () => {
    if (!canNativeShare) return;
    try {
      await navigator.share({ title, text: description, url: activeUrl });
    } catch {
      // user cancelled
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ||
          'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors'
        }
      >
        <QrCode className="w-4 h-4" />
        {triggerLabel}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-sm surface-card p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{title}</h3>
                {description && <p className="text-sm text-white/60 mt-1">{description}</p>}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Wallet selector tabs */}
            {walletUrls && (
              <div className="flex gap-1.5 mb-4">
                {WALLET_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => { setCopied(false); setSelectedWallet(tab.key); }}
                    className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${
                      selectedWallet === tab.key
                        ? `${tab.accent} text-white ring-1 ring-white/20`
                        : 'text-white/50 hover:text-white/70 hover:bg-white/5'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            <div className="bg-white rounded-xl p-3 flex items-center justify-center mb-4">
              <QRCode value={activeUrl} size={180} />
            </div>

            {walletUrls && selectedWallet !== 'web' && (
              <p className="text-[10px] text-white/50 text-center mb-2">
                Scan with {selectedWallet === 'metamask' ? 'MetaMask' : 'Coinbase Wallet'} QR scanner to open directly in-app
              </p>
            )}

            <div className="rounded-lg bg-black/30 p-2.5 mb-3">
              <p className="text-[11px] text-white/40 mb-1">Share link</p>
              <p className="text-xs font-mono text-white/75 break-all">{activeUrl}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 text-white/85 hover:bg-white/20 transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-[#0BB89A]" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>

              {canNativeShare ? (
                <button
                  type="button"
                  onClick={handleNativeShare}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0BB89A] text-white hover:bg-[#0BB89A]/90 transition-colors"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0BB89A] text-white hover:bg-[#0BB89A]/90 transition-colors"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
