'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, Loader2, QrCode, WalletCards } from 'lucide-react';
import BrandedQRCode from '@/components/BrandedQRCode';

type PriceTag = {
  code: string;
  amountDisplay: string;
  description: string;
  recipientAddress: string;
  chainName: string;
  tokenSymbol: 'USDC';
  paymentUrl: string;
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className="p-1.5 rounded hover:bg-white/10 transition-colors flex items-center justify-center"
      title={label}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-[#0BB89A]" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-white/50 hover:text-white/80" />
      )}
    </button>
  );
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function CreatePriceTagCard() {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [createdTag, setCreatedTag] = useState<PriceTag | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const canSubmit = useMemo(
    () => amount.trim() && description.trim() && recipientAddress.trim() && !isLoading,
    [amount, description, isLoading, recipientAddress],
  );

  const handlePasteAddress = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRecipientAddress(text.trim());
    } catch {
      setError('Could not read clipboard');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/price-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          description,
          recipientAddress,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create price tag');
      }

      setCreatedTag(data.priceTag);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create price tag');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setCreatedTag(null);
    setAmount('');
    setDescription('');
    setRecipientAddress('');
    setError('');
  };

  if (createdTag) {
    return (
      <div className="surface-card p-5 w-[320px]">
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={handleReset}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Create another price tag"
          >
            <ArrowLeft className="w-4 h-4 text-white/60" />
          </button>
          <h3 className="text-lg font-semibold text-white">Base USDC QR</h3>
        </div>

        <p className="text-sm text-white/70 mb-3 truncate">{createdTag.description}</p>

        <div className="text-center mb-4">
          <span className="text-2xl font-bold text-white">${createdTag.amountDisplay}</span>
          <span className="text-sm text-white/60 ml-1">USDC</span>
        </div>

        <div className="mb-4">
          <BrandedQRCode value={createdTag.paymentUrl} size={180} />
        </div>

        <div className="space-y-2">
          <div>
            <div className="text-[11px] text-white/50 mb-0.5">Payment Link</div>
            <div className="flex items-center gap-1">
              <code className="font-mono text-[11px] text-white/70 truncate max-w-[230px]">
                {createdTag.paymentUrl}
              </code>
              <CopyButton value={createdTag.paymentUrl} label="Copy payment link" />
            </div>
          </div>
          <div>
            <div className="text-[11px] text-white/50 mb-0.5">Recipient</div>
            <div className="flex items-center gap-1">
              <code className="font-mono text-sm text-white/90">
                {shortenAddress(createdTag.recipientAddress)}
              </code>
              <CopyButton value={createdTag.recipientAddress} label="Copy recipient address" />
            </div>
          </div>
        </div>

        <p className="text-[11px] text-white/40 mt-3 text-center">
          Print or display this QR. Payments settle directly to your Base wallet.
        </p>
      </div>
    );
  }

  return (
    <div className="surface-card p-5 w-[320px]">
      <div className="flex items-center gap-2 mb-3">
        <QrCode className="w-5 h-5 text-[#0BB89A]" />
        <h3 className="text-lg font-semibold text-white">Accept USDC on Base</h3>
      </div>
      <p className="text-xs text-white/50 mb-4">
        Create a hosted QR price tag. Funds go directly to your Base wallet.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-xs text-white/70 mb-1 block">Amount</label>
          <div className="flex items-center bg-white/10 border border-white/20 rounded-lg focus-within:border-[#0BB89A]/70 transition-colors">
            <span className="text-white/50 text-sm pl-3">$</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="10000"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="5.00"
              className="w-full bg-transparent px-2 py-2 text-sm text-white placeholder-white/30 focus:outline-none"
            />
            <span className="text-white/50 text-xs pr-3">USDC</span>
          </div>
        </div>

        <div>
          <label className="text-xs text-white/70 mb-1 block">Description</label>
          <input
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Taco"
            maxLength={120}
            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#0BB89A]/70 transition-colors"
          />
        </div>

        <div>
          <label className="text-xs text-white/70 mb-1 block">Base Wallet Address</label>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={recipientAddress}
              onChange={(event) => setRecipientAddress(event.target.value.trim())}
              placeholder="0x..."
              className="flex-1 min-w-0 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#0BB89A]/70 transition-colors"
            />
            <button
              type="button"
              onClick={handlePasteAddress}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              title="Paste address"
            >
              <WalletCards className="w-4 h-4 text-white/60" />
            </button>
          </div>
        </div>

        {error && <p className="text-red-400 text-xs">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-[#0BB89A] hover:bg-[#0BB89A]/90 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Price Tag'
          )}
        </button>
      </form>

      <div className="mt-3 p-2.5 bg-white/5 md:bg-white/10 rounded-lg border border-white/10 md:border-white/20 backdrop-blur-sm">
        <p className="text-[10px] text-white/60 md:text-white/80 leading-relaxed">
          <strong className="text-white/80 md:text-white">Network:</strong> Base
          <br />
          <strong className="text-white/80 md:text-white">Token:</strong> USDC
          <br />
          <strong className="text-white/80 md:text-white">Fees:</strong> None from Crow
        </p>
      </div>

      <Link
        href="/my-tags"
        className="mt-3 block text-center text-xs text-white/50 hover:text-white/80 transition-colors"
      >
        View my price tags
      </Link>
    </div>
  );
}
