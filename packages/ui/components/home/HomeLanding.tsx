'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import QRCode from 'react-qr-code';
import {
  BadgeDollarSign,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Download,
  ExternalLink,
  UserRoundX,
  Zap,
  Landmark,
  BadgeCheck,
  Loader2,
  Lock,
  Menu,
  MoreVertical,
  QrCode,
  Share2,
  ShieldCheck,
  Sparkles,
  Tag,
  Wallet,
} from 'lucide-react';
import BrandedQRCode from '@/components/BrandedQRCode';
import type { PriceTag } from '@/lib/base-price-tags/types';

const SAMPLE_TAG = {
  code: 'taco-5',
  amountDisplay: '5.00',
  description: 'Taco',
  recipientAddress: '0x8f3c4b263c31d9387dc6e22d2f1d7c4a2973a4b2',
  paymentUrl: 'https://crow.id/taco-5',
};

type CreatedTag = Pick<
  PriceTag,
  'code' | 'amountDisplay' | 'description' | 'recipientAddress' | 'paymentUrl'
>;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeWallet(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error('Wallet did not return a valid address');
  }

  return value as `0x${string}`;
}

function chainIdToHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

function CopyButton({
  value,
  label,
  className = '',
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/18 text-white/72 transition hover:bg-white/14 hover:text-white active:scale-[0.98] ${className}`}
      title={label}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[#0BB89A]" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const HERO_BADGES = [
  { label: 'No Sign Up Required', icon: UserRoundX },
  { label: 'No Fees', icon: BadgeCheck },
  { label: 'No Bank', icon: Landmark },
  { label: 'Instant Settlement', icon: Zap },
] as const;

function HeroBadges() {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (visible >= HERO_BADGES.length) return;
    const id = setTimeout(() => setVisible((v) => v + 1), visible === 0 ? 200 : 350);
    return () => clearTimeout(id);
  }, [visible]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {HERO_BADGES.map((badge, i) => {
        const Icon = badge.icon;
        return (
          <div
            key={badge.label}
            className="inline-flex items-center gap-2 rounded-lg border border-white/22 bg-white/12 px-3 py-1.5 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] transition-all duration-500"
            style={{
              opacity: i < visible ? 1 : 0,
              transform: i < visible ? 'translateY(0)' : 'translateY(6px)',
            }}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#0BB89A] text-white">
              <Icon className="h-3 w-3" />
            </span>
            {badge.label}
          </div>
        );
      })}
    </div>
  );
}

function Header() {
  return (
    <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 pt-6 lg:px-6">
      <Link href="/" className="flex items-center gap-3 text-white">
        <Image src="/Crow Logo Isoloated White.png" alt="" width={42} height={42} className="h-9 w-9 object-contain" />
        <span className="text-2xl font-semibold tracking-tight">Crow</span>
      </Link>

      <nav className="hidden items-center gap-12 text-sm font-semibold text-white/82 lg:flex">
        <a href="#how-it-works" className="transition hover:text-white">
          How it works
        </a>
        <a href="#tags" className="transition hover:text-white">
          Tags
        </a>
        <a href="#compare" className="transition hover:text-white">
          Compare
        </a>
      </nav>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => document.getElementById('wallet-address')?.focus()}
          className="hidden items-center gap-2 rounded-lg bg-[#0BB89A] px-5 py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_14px_40px_rgba(11,184,154,0.22)] transition hover:bg-[#10c7a6] active:scale-[0.98] sm:inline-flex"
        >
          <Wallet className="h-4 w-4" />
          Connect wallet
        </button>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/18 bg-white/14 text-white/82 lg:hidden"
          title="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}

function PriceTagForm({
  onCreated,
}: {
  onCreated: (tag: CreatedTag) => void;
}) {
  const [amount, setAmount] = useState('5.00');
  const [description, setDescription] = useState('Taco');
  const [recipientAddress, setRecipientAddress] = useState('');
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
      setError('');
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
        body: JSON.stringify({ amount, description, recipientAddress }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create tag');
      }

      onCreated(data.priceTag);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tag');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-5 w-full max-w-[540px] rounded-2xl border border-white/24 bg-[#66527f]/72 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_24px_70px_rgba(52,31,78,0.2)] backdrop-blur-2xl lg:p-5"
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-white/82">Item name</span>
          <div className="flex items-center gap-2 rounded-lg border border-white/24 bg-white/12 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] focus-within:border-[#0BB89A]/80">
            <Tag className="h-4 w-4 text-amber-300" />
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={120}
              placeholder="Taco"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/55"
            />
          </div>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-white/82">Amount (USDC)</span>
          <div className="flex items-center rounded-lg border border-white/24 bg-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] focus-within:border-[#0BB89A]/80">
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="10000"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="5.00"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/55"
            />
            <span className="flex items-center gap-1.5 border-l border-white/16 px-3 text-xs font-semibold text-white/76">
              <CircleDollarSign className="h-4 w-4 text-blue-300" />
              USDC
            </span>
          </div>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-white/82">Wallet address</span>
          <div className="flex items-center gap-2 rounded-lg border border-white/24 bg-white/12 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] focus-within:border-[#0BB89A]/80">
            <input
              id="wallet-address"
              value={recipientAddress}
              onChange={(event) => setRecipientAddress(event.target.value.trim())}
              placeholder="0x8f3c...a4b2"
              className="min-w-0 flex-1 bg-transparent font-mono text-sm text-white outline-none placeholder:text-white/55"
            />
            <button
              type="button"
              onClick={handlePasteAddress}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/18 text-white/72 transition hover:bg-white/14 hover:text-white"
              title="Paste address"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </label>
      </div>

      {error && <p className="mt-3 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100">{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0BB89A] px-5 py-2.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)] transition hover:bg-[#10c7a6] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating tag
          </>
        ) : (
          <>
            Create Tag
            <Sparkles className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}

function PaymentTagPreview({ tag }: { tag: CreatedTag | typeof SAMPLE_TAG }) {
  const displayLink = tag.paymentUrl.replace(/^https?:\/\//, '');

  return (
    <div className="rounded-2xl border border-white/24 bg-[#5c4d78]/70 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_24px_70px_rgba(52,31,78,0.18)] backdrop-blur-2xl lg:flex lg:h-full lg:flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Your payment tag</h2>
        <span className="rounded-full border border-[#0BB89A]/25 bg-[#0BB89A]/10 px-2.5 py-1 text-xs font-medium text-[#64e6d0]">
          Ready
        </span>
      </div>

      <BrandedQRCode value={tag.paymentUrl} size={206} />

      <p className="mx-auto mt-4 max-w-[220px] text-center text-base font-medium leading-snug text-white">
        Scan to pay {tag.amountDisplay} USDC on Base
      </p>

      <div className="mt-7 flex items-center justify-between gap-3 rounded-lg border border-white/20 bg-white/10 px-3 py-3">
        <span className="min-w-0 truncate font-mono text-sm font-semibold text-blue-300">{displayLink}</span>
        <CopyButton value={tag.paymentUrl} label="Copy payment link" className="shrink-0" />
      </div>

      <div className="mt-6 border-t border-white/10 pt-4">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-medium text-white/68 transition hover:text-white"
        >
          <Share2 className="h-4 w-4" />
          Share link
        </button>
      </div>
    </div>
  );
}

function PhonePreview({ tag }: { tag: CreatedTag | typeof SAMPLE_TAG }) {
  return (
    <div className="mx-auto w-[276px] rounded-[2rem] border border-white/26 bg-[#302747]/70 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_26px_60px_rgba(52,31,78,0.28)] lg:h-full">
      <div className="rounded-[1.65rem] border border-white/14 bg-[linear-gradient(160deg,rgba(94,83,142,0.98),rgba(39,43,91,0.96))] px-4 py-4">
        <div className="flex items-center justify-between text-[11px] font-semibold text-white">
          <span>9:41</span>
          <span className="tracking-[0.18em]">Base</span>
        </div>

        <div className="mt-5 flex items-center justify-between text-white/65">
          <ChevronRight className="h-4 w-4 rotate-180" />
          <span className="font-mono text-[11px]">crow.id/{tag.code}</span>
          <ShieldCheck className="h-4 w-4" />
        </div>

        <div className="mt-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/25 ring-1 ring-blue-200/25">
            <CircleDollarSign className="h-9 w-9 text-blue-200" />
          </div>
          <div className="mt-5">
            <span className="text-3xl font-semibold text-white">${tag.amountDisplay}</span>
            <span className="ml-2 text-xl text-white/62">USDC</span>
          </div>
          <p className="mt-2 text-base font-medium text-white/86">{tag.description}</p>
        </div>

        <div className="mt-8">
          <p className="mb-2 text-xs font-medium text-white/55">Pay with</p>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-white/[0.08] px-3 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.12]"
          >
            <span className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-xs font-bold">B</span>
              Base
            </span>
            <ChevronRight className="h-4 w-4 text-white/62" />
          </button>
          <button
            type="button"
            className="mt-2 flex w-full items-center gap-2 rounded-lg border border-white/15 bg-white/[0.08] px-3 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.12]"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500">
              <Wallet className="h-3.5 w-3.5" />
            </span>
            Coinbase Wallet
          </button>
        </div>

        <div className="mt-12 flex items-center justify-center gap-1.5 text-xs text-white/54">
          <ShieldCheck className="h-3.5 w-3.5" />
          Secured by Base
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const [createdTag, setCreatedTag] = useState<CreatedTag | null>(null);
  const activeTag = createdTag ?? SAMPLE_TAG;

  return (
    <section className="mx-auto grid w-full max-w-7xl gap-8 px-5 pb-8 pt-10 lg:grid-cols-[1.55fr_0.78fr_0.78fr] lg:items-end lg:px-6 lg:pb-12 lg:pt-10">
      <div className="lg:pt-4">
        <HeroBadges />
        <h1 className="mt-5 max-w-[650px] text-5xl font-bold leading-[1.04] tracking-tight text-white lg:text-[3.65rem] xl:text-[3.9rem]">
          Create a crypto price tag in seconds.
        </h1>
        <p className="mt-5 max-w-[530px] text-lg leading-7 text-white/82">
          Sellers create a fixed-price USDC payment tag. Buyers scan and pay directly on Base. Funds land directly in your wallet.
        </p>
        <PriceTagForm onCreated={setCreatedTag} />
        <p className="mt-4 flex items-center gap-2 text-sm font-medium text-white/78">
          <Lock className="h-4 w-4" />
          No custody. Crow never holds your funds.
        </p>
      </div>

      <div className="flex flex-col lg:pt-8">
        <PaymentTagPreview tag={activeTag} />
      </div>

      <div className="hidden lg:flex lg:flex-col">
        <PhonePreview tag={activeTag} />
      </div>
    </section>
  );
}

function DownloadQrButton({ tag }: { tag: PriceTag }) {
  const qrRef = useRef<HTMLDivElement>(null);

  const handleDownload = () => {
    const svg = qrRef.current?.querySelector('svg');

    if (!svg) {
      return;
    }

    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const source = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${tag.description.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || tag.code}-qr.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center gap-3">
      <div ref={qrRef} className="rounded-md bg-white p-1">
        <QRCode value={tag.paymentUrl} size={36} level="H" />
      </div>
      <button
        type="button"
        onClick={handleDownload}
        className="hidden h-8 w-8 items-center justify-center rounded-md border border-white/18 text-white/72 transition hover:bg-white/14 hover:text-white lg:inline-flex"
        title="Download QR"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function HomeTagsTable() {
  const [wallet, setWallet] = useState<`0x${string}` | null>(null);
  const [tags, setTags] = useState<PriceTag[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [error, setError] = useState('');

  const fetchTags = async (recipient: `0x${string}`) => {
    setIsLoadingTags(true);
    setError('');

    try {
      const response = await fetch(`/api/price-tags?recipient=${recipient}&limit=100`, { cache: 'no-store' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load tags');
      }

      setTags(data.priceTags || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tags');
      setTags([]);
    } finally {
      setIsLoadingTags(false);
    }
  };

  const connectWallet = async () => {
    setError('');
    setIsConnecting(true);

    try {
      if (!window.ethereum) {
        throw new Error('No injected wallet found. Open this page in a wallet browser or install a wallet extension.');
      }

      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const firstAccount = Array.isArray(accounts) ? normalizeWallet(accounts[0]) : null;

      if (!firstAccount) {
        throw new Error('No wallet account returned');
      }

      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdToHex(8453) }],
        });
      } catch {
        // Lookup only needs the wallet address.
      }

      setWallet(firstAccount);
      await fetchTags(firstAccount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet connection failed');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <section id="tags" className="mx-auto w-full max-w-7xl px-5 py-8 lg:px-6">
      <div className="overflow-hidden rounded-2xl border border-white/24 bg-[#5c4d78]/68 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_24px_80px_rgba(52,31,78,0.18)] backdrop-blur-2xl">
        <div className="flex flex-col gap-4 border-b border-white/16 p-5 sm:flex-row sm:items-center sm:justify-between lg:p-7">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Your tags</h2>
            <p className="mt-1 text-sm text-white/76">Connect your wallet to see tags pointing to you.</p>
          </div>
          <button
            type="button"
            onClick={connectWallet}
            disabled={isConnecting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0BB89A] px-5 py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] transition hover:bg-[#10c7a6] active:scale-[0.98] disabled:opacity-55"
          >
            {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            {wallet ? shortAddress(wallet) : 'Connect wallet'}
          </button>
        </div>

        {error && <div className="border-b border-red-400/20 bg-red-500/10 px-5 py-3 text-sm text-red-100">{error}</div>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-white/10 text-xs text-white/68">
              <tr>
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 font-medium">Amount (USDC)</th>
                <th className="px-5 py-3 font-medium">Wallet</th>
                <th className="px-5 py-3 font-medium">Payment Link</th>
                <th className="px-5 py-3 font-medium">QR</th>
                <th className="px-5 py-3 font-medium" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/14">
              {!wallet ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-white/76">
                    Connect a wallet to load your active tags.
                  </td>
                </tr>
              ) : isLoadingTags ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8">
                    <div className="mx-auto h-4 w-56 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full w-24 animate-pulse rounded-full bg-white/20" />
                    </div>
                  </td>
                </tr>
              ) : tags.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-white/76">
                    Create a tag above to get started.
                  </td>
                </tr>
              ) : (
                tags.map((tag) => (
                  <tr key={tag.code} className="text-white/82 transition hover:bg-white/[0.06]">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-amber-300" />
                        <span className="font-medium text-white">{tag.description}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-1.5 font-mono text-white/74">
                        <CircleDollarSign className="h-4 w-4 text-blue-300" />
                        {tag.amountDisplay}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-xs text-white/62">{shortAddress(tag.recipientAddress)}</code>
                        <CopyButton value={tag.recipientAddress} label="Copy wallet address" />
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/pay/${tag.code}`}
                          className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-blue-300 transition hover:text-blue-200"
                        >
                          {tag.paymentUrl.replace(/^https?:\/\//, '')}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                        <CopyButton value={tag.paymentUrl} label="Copy payment link" />
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <DownloadQrButton tag={tag} />
                    </td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/50 transition hover:bg-white/10 hover:text-white"
                        title="More actions"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: Tag,
      title: 'Create a tag',
      text: 'Add an item name, set a fixed USDC price, and enter your Base wallet address.',
    },
    {
      icon: QrCode,
      title: 'Share or print the QR',
      text: 'Share the hosted link or display the QR code where buyers can scan it.',
    },
    {
      icon: BadgeDollarSign,
      title: 'Get paid in USDC on Base',
      text: 'Payments settle directly to your wallet on Base. Crow never custodies the funds.',
    },
  ];

  return (
    <section id="how-it-works" className="mx-auto w-full max-w-7xl px-5 py-8 lg:px-6">
      <h2 className="text-center text-xs font-semibold uppercase tracking-[0.48em] text-white/82">How it works</h2>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.05fr_0.9fr_1.05fr]">
        {steps.map((step, index) => {
          const Icon = step.icon;

          return (
            <article
              key={step.title}
              className="rounded-xl border border-white/24 bg-[#5c4d78]/66 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-xl"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-blue-500/14">
                  <Icon className="h-8 w-8 text-blue-200" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white/76">
                      {index + 1}
                    </span>
                    <h3 className="font-semibold text-white">{step.title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/78">{step.text}</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CompetitorMatrix() {
  const rows = [
    ['Sign up required', 'No', 'Yes', 'Yes', 'Yes', 'Yes'],
    ['Fees', 'No fees', '2.7% + 5c in person', '2.6% + 15c in person', '2.29% + 9c in person', '2.3%-2.6% + 10c in person'],
    ['Primary rail', 'USDC on Base', 'Card and bank rails', 'Card and bank rails', 'Wallet, card, bank', 'Card and POS rails'],
    ['Settlement destination', 'Your Base wallet', 'Merchant account', 'Merchant account', 'Merchant account', 'Merchant account'],
    ['Hardware required', 'No', 'No', 'Optional', 'No', 'Often paired with POS'],
    ['Static QR price tags', 'Native QR + Payment links', 'Payment links', 'QR and POS tools', 'QR and checkout tools', 'POS-first'],
    ['Chargebacks', 'No card chargebacks', 'Card chargebacks apply', 'Card chargebacks apply', 'Disputes apply', 'Card chargebacks apply'],
    ['Custody model', 'Crow never holds funds', 'Platform-managed flow', 'Platform-managed flow', 'Platform-managed flow', 'Platform-managed flow'],
  ];

  return (
    <section id="compare" className="mx-auto w-full max-w-7xl px-5 py-8 lg:px-6 lg:pb-14">
      <div className="mb-5 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.38em] text-white/70">Competitor matrix</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-white">Stablecoin tags versus payment platforms</h2>
        </div>
        <p className="max-w-xl text-sm leading-6 text-white/78">
          Crow is not trying to replace full merchant processing. It is a focused tool for fixed-price USDC payments that settle directly to a wallet.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/24 bg-[#5c4d78]/66 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_24px_80px_rgba(52,31,78,0.16)] backdrop-blur-2xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-white/10 text-xs uppercase tracking-[0.12em] text-white/68">
              <tr>
                <th className="px-5 py-4 font-semibold">Capability</th>
                <th className="px-5 py-4 font-semibold text-[#64e6d0]">Crow</th>
                <th className="px-5 py-4 font-semibold">Stripe</th>
                <th className="px-5 py-4 font-semibold">Square</th>
                <th className="px-5 py-4 font-semibold">PayPal</th>
                <th className="px-5 py-4 font-semibold">Clover</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/14">
              {rows.map((row, rowIndex) => (
                <tr key={row[0]} className="text-white/82">
                  {row.map((cell, index) => (
                    <td
                      key={`${rowIndex}-${index}`}
                      className={`whitespace-nowrap px-5 py-4 ${index === 0 ? 'font-medium text-white/86' : ''} ${index === 1 ? 'font-semibold text-white' : ''}`}
                    >
                      {index === 1 ? (
                        <span className="inline-flex items-center gap-2">
                          <Check className="h-4 w-4 text-[#0BB89A]" />
                          {cell}
                        </span>
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function FooterCta() {
  return (
    <footer className="mx-auto w-full max-w-7xl px-5 pb-8 lg:px-6">
      <div className="grid gap-6 rounded-2xl border border-white/24 bg-[#5c4d78]/62 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-2xl lg:grid-cols-[1fr_1.2fr_0.9fr] lg:items-center">
        <div>
          <div className="flex items-center gap-3">
            <Image src="/Crow Logo Isoloated White.png" alt="" width={38} height={38} className="h-8 w-8 object-contain" />
            <span className="text-xl font-semibold text-white">Crow</span>
          </div>
          <p className="mt-2 max-w-xs text-sm leading-6 text-white/78">Simple USDC payment tags for sellers on Base.</p>
        </div>

        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Start accepting USDC today</h2>
          <p className="mt-2 text-sm text-white/78">Create your first tag in seconds.</p>
        </div>

        <button
          type="button"
          onClick={() => document.getElementById('wallet-address')?.focus()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0BB89A] px-6 py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] transition hover:bg-[#10c7a6] active:scale-[0.98]"
        >
          Create a tag
          <Sparkles className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-3 px-2 py-7 text-xs font-medium text-white/68 sm:flex-row sm:items-center sm:justify-between">
        <p>Copyright 2026 Crow. All rights reserved.</p>
        <div className="flex gap-6">
          <a href="#tags" className="transition hover:text-white/75">
            Product
          </a>
          <a href="#how-it-works" className="transition hover:text-white/75">
            Resources
          </a>
          <a href="#compare" className="transition hover:text-white/75">
            Compare
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function HomeLanding() {
  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#765f8f] bg-[url('/clouds.png')] bg-cover bg-center bg-fixed bg-no-repeat">
      <div className="fixed inset-0 z-0 bg-[linear-gradient(180deg,rgba(112,82,142,0.06),rgba(177,92,146,0.08)_42%,rgba(78,93,159,0.1))]" />

      <div className="relative z-10">
        <Header />
        <Hero />
        <HomeTagsTable />
        <HowItWorks />
        <CompetitorMatrix />
        <FooterCta />
      </div>
    </main>
  );
}
