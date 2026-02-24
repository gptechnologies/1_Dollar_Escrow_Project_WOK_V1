'use client';

import { useState } from 'react';
import { Loader2, Copy, Check, ClipboardPaste, QrCode, ArrowLeft } from 'lucide-react';
import QRCode from 'react-qr-code';
import { USDC_ADDRESS, USDT_ADDRESS } from '@/lib/chain';
import { buildEIP681Uri, buildPaymentUrl } from '@/lib/payment';

const TOKEN_OPTIONS = [
  { value: 'USDC', label: 'USDC', address: process.env.NEXT_PUBLIC_USDC_ADDRESS || USDC_ADDRESS },
  { value: 'USDT', label: 'USDT', address: process.env.NEXT_PUBLIC_USDT_ADDRESS || USDT_ADDRESS },
];

function CopyInline({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded hover:bg-white/10 transition-colors flex items-center justify-center"
      title={label || 'Copy'}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-[#0BB89A]" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-white/50 hover:text-white/80" />
      )}
    </button>
  );
}

interface CreatedLink {
  code: string;
  wallet: string;
  token: string;
  tokenSymbol: string;
  amount: string;
  description?: string;
}

export default function AcceptPaymentCard() {
  const [wallet, setWallet] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState('USDC');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdLink, setCreatedLink] = useState<CreatedLink | null>(null);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (/^0x[a-fA-F0-9]{40}$/.test(text.trim())) {
        setWallet(text.trim());
      }
    } catch {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      setError('Enter a valid wallet address');
      return;
    }
    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setError('Enter a valid amount');
      return;
    }

    const tokenOption = TOKEN_OPTIONS.find((t) => t.value === selectedToken)!;
    const rawAmount = Math.round(numAmount * 1e6).toString();

    setIsLoading(true);
    try {
      const res = await fetch('/api/payment/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet,
          token: tokenOption.address,
          amount: rawAmount,
          description: description.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create payment link');
      }

      setCreatedLink({
        code: data.code,
        wallet,
        token: tokenOption.address,
        tokenSymbol: selectedToken,
        amount: rawAmount,
        description: description.trim() || undefined,
      });
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setCreatedLink(null);
    setWallet('');
    setAmount('');
    setDescription('');
    setError('');
  };

  if (createdLink) {
    const eip681 = buildEIP681Uri(createdLink.token, createdLink.wallet, createdLink.amount);
    const paymentUrl = buildPaymentUrl(createdLink.code);
    const displayAmount = (Number(createdLink.amount) / 1e6).toFixed(2);

    return (
      <div className="surface-card p-5 w-[320px]">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={handleReset}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Create another"
          >
            <ArrowLeft className="w-4 h-4 text-white/60" />
          </button>
          <h3 className="text-lg font-semibold text-white">Payment QR</h3>
        </div>

        {createdLink.description && (
          <p className="text-sm text-white/70 mb-3 truncate">{createdLink.description}</p>
        )}

        <div className="text-center mb-4">
          <span className="text-2xl font-bold text-white">
            ${displayAmount}
          </span>
          <span className="text-sm text-white/60 ml-1">{createdLink.tokenSymbol}</span>
        </div>

        <div className="bg-white rounded-xl p-3 mx-auto w-fit mb-4">
          <QRCode value={eip681} size={180} level="M" />
        </div>

        <div className="space-y-2">
          <div>
            <div className="text-[11px] text-white/50 mb-0.5">Lookup Code</div>
            <div className="flex items-center gap-1">
              <code className="font-mono text-sm text-white/90">{createdLink.code}</code>
              <CopyInline value={createdLink.code} />
            </div>
          </div>
          <div>
            <div className="text-[11px] text-white/50 mb-0.5">Shareable Link</div>
            <div className="flex items-center gap-1">
              <code className="font-mono text-[11px] text-white/70 truncate max-w-[230px]">
                {paymentUrl}
              </code>
              <CopyInline value={paymentUrl} />
            </div>
          </div>
        </div>

        <p className="text-[11px] text-white/40 mt-3 text-center">
          Scan with any wallet&apos;s QR scanner to pay instantly.
        </p>
      </div>
    );
  }

  return (
    <div className="surface-card p-5 w-[320px]">
      <div className="flex items-center gap-2 mb-3">
        <QrCode className="w-5 h-5 text-[#0BB89A]" />
        <h3 className="text-lg font-semibold text-white">Accept Stablecoins</h3>
      </div>
      <p className="text-xs text-white/50 mb-4">
        Create a QR code to accept USDC or USDT payments on Arbitrum.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Wallet address */}
        <div>
          <label className="text-xs text-white/70 mb-1 block">Your Wallet Address</label>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={wallet}
              onChange={(e) => setWallet(e.target.value.trim())}
              placeholder="0x ..."
              className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#0BB89A]/70 transition-colors"
            />
            <button
              type="button"
              onClick={handlePaste}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              title="Paste address"
            >
              <ClipboardPaste className="w-4 h-4 text-white/60" />
            </button>
          </div>
        </div>

        {/* Amount + Token */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-white/70 mb-1 block">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100.00"
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#0BB89A]/70 transition-colors"
            />
          </div>
          <div className="w-[80px]">
            <label className="text-xs text-white/70 mb-1 block">Token</label>
            <select
              value={selectedToken}
              onChange={(e) => setSelectedToken(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-[#0BB89A]/70 transition-colors appearance-none cursor-pointer"
            >
              {TOKEN_OPTIONS.map((t) => (
                <option key={t.value} value={t.value} className="bg-gray-900">
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-white/70 mb-1 block">Description (optional)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Invoice #42"
            maxLength={120}
            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#0BB89A]/70 transition-colors"
          />
        </div>

        {error && (
          <p className="text-red-400 text-xs">{error}</p>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-[#0BB89A] hover:bg-[#0BB89A]/90 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Payment Link'
          )}
        </button>
      </form>
    </div>
  );
}
