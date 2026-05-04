'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import QRCode from 'react-qr-code';
import {
  Check,
  CircleCheck,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  QrCode,
  ReceiptText,
  Wallet,
} from 'lucide-react';
import type { PriceTag, PriceTagPaymentWithTag } from '@/lib/base-price-tags/types';

type ChainConfig = {
  chainId: number;
  chainName: string;
  testnet: boolean;
};

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatPaymentTime(value: string | null): string {
  if (!value) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
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

function CopyLinkButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[#0BB89A]" /> : <Copy className="h-3.5 w-3.5" />}
      Copy
    </button>
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
        <QRCode value={tag.paymentUrl} size={48} level="H" />
      </div>
      <button
        type="button"
        onClick={handleDownload}
        className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
      >
        <Download className="h-3.5 w-3.5" />
        Download
      </button>
    </div>
  );
}

export default function MyTagsClient({ chain }: { chain: ChainConfig }) {
  const [activeTab, setActiveTab] = useState<'tags' | 'transactions'>('tags');
  const [wallet, setWallet] = useState<`0x${string}` | null>(null);
  const [tags, setTags] = useState<PriceTag[]>([]);
  const [payments, setPayments] = useState<PriceTagPaymentWithTag[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);
  const [error, setError] = useState('');

  const fetchTags = async (recipient: `0x${string}`) => {
    setIsLoadingTags(true);
    setError('');

    try {
      const response = await fetch(`/api/price-tags?recipient=${recipient}&limit=100`, {
        cache: 'no-store',
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load price tags');
      }

      setTags(data.priceTags || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load price tags');
      setTags([]);
    } finally {
      setIsLoadingTags(false);
    }
  };

  const fetchPayments = async (recipient: `0x${string}`) => {
    setIsLoadingPayments(true);
    setError('');

    try {
      const response = await fetch(`/api/payments?recipient=${recipient}&limit=100`, {
        cache: 'no-store',
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load transactions');
      }

      setPayments(data.payments || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
      setPayments([]);
    } finally {
      setIsLoadingPayments(false);
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
          params: [{ chainId: chainIdToHex(chain.chainId) }],
        });
      } catch {
        // Chain switching is convenient, but tag lookup only needs the address.
      }

      setWallet(firstAccount);
      await Promise.all([fetchTags(firstAccount), fetchPayments(firstAccount)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet connection failed');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <main className="min-h-screen relative px-4 py-10">
      <div className="fixed inset-0 -z-10 bg-[url('/clouds.png')] bg-cover bg-center bg-no-repeat" />

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="text-xs text-white/50 hover:text-white/80 transition-colors">
              Back to Crow
            </Link>
            <h1 className="mt-2 text-3xl font-bold text-white">My Base USDC Price Tags</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/60">
              Connect the wallet that receives payments. We will show every active tag paying to that wallet.
            </p>
          </div>

          <button
            type="button"
            onClick={connectWallet}
            disabled={isConnecting}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0BB89A] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0BB89A]/90 disabled:opacity-50"
          >
            {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            {wallet ? shortenAddress(wallet) : 'Connect Base Wallet'}
          </button>
        </div>

        <div className="surface-card overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                {activeTab === 'tags' ? (
                  <QrCode className="h-4 w-4 text-[#0BB89A]" />
                ) : (
                  <ReceiptText className="h-4 w-4 text-[#0BB89A]" />
                )}
                <h2 className="text-base font-semibold text-white">
                  {activeTab === 'tags' ? 'Active Tags' : 'Recent Transactions'}
                </h2>
              </div>
              <p className="mt-1 text-xs text-white/50">
                Lookup uses recipient wallet only. No account, password, or signature required.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:items-end">
              <span className="text-xs text-white/50">{chain.chainName}</span>
              <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('tags')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeTab === 'tags'
                      ? 'bg-[#0BB89A] text-white'
                      : 'text-white/60 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  Active Tags{wallet ? ` (${tags.length})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('transactions')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeTab === 'transactions'
                      ? 'bg-[#0BB89A] text-white'
                      : 'text-white/60 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  Recent Transactions{wallet ? ` (${payments.length})` : ''}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="border-b border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
              {error}
            </div>
          )}

          {!wallet ? (
            <div className="p-8 text-center">
              <p className="text-sm text-white/65">Connect your receiving wallet to load your tags and transactions.</p>
            </div>
          ) : activeTab === 'tags' && isLoadingTags ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-white/65">
              <Loader2 className="h-4 w-4 animate-spin text-[#0BB89A]" />
              Loading tags...
            </div>
          ) : activeTab === 'transactions' && isLoadingPayments ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-white/65">
              <Loader2 className="h-4 w-4 animate-spin text-[#0BB89A]" />
              Loading transactions...
            </div>
          ) : activeTab === 'tags' && tags.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-white/75">No price tags found for {shortenAddress(wallet)}.</p>
              <Link href="/" className="mt-3 inline-flex text-sm text-[#0BB89A] hover:text-[#0BB89A]/80">
                Create a price tag
              </Link>
            </div>
          ) : activeTab === 'transactions' && payments.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-white/75">No confirmed payments found for {shortenAddress(wallet)}.</p>
            </div>
          ) : activeTab === 'tags' ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/45">
                  <tr>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Recipient</th>
                    <th className="px-4 py-3 font-medium">Payment Link</th>
                    <th className="px-4 py-3 font-medium">QR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {tags.map((tag) => (
                    <tr key={tag.code} className="text-white/80">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{tag.description}</div>
                        <div className="font-mono text-[11px] text-white/40">{tag.code}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{tag.amountDisplay} USDC</td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-xs text-white/70">{shortenAddress(tag.recipientAddress)}</code>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/pay/${tag.code}`}
                            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                          >
                            View
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                          <CopyLinkButton value={tag.paymentUrl} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <DownloadQrButton tag={tag} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/45">
                  <tr>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">From</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Tx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {payments.map((payment) => (
                    <tr key={payment.id} className="text-white/80">
                      <td className="px-4 py-3 whitespace-nowrap text-white/65">
                        {formatPaymentTime(payment.confirmedAt || payment.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">
                          {payment.priceTagDescription || payment.priceTagCode}
                        </div>
                        <div className="font-mono text-[11px] text-white/40">{payment.priceTagCode}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{payment.expectedAmountDisplay} USDC</td>
                      <td className="px-4 py-3">
                        {payment.payerAddress ? (
                          <code className="font-mono text-xs text-white/70">
                            {shortenAddress(payment.payerAddress)}
                          </code>
                        ) : (
                          <span className="text-xs text-white/45">Unknown</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#0BB89A]/25 bg-[#0BB89A]/10 px-2 py-1 text-xs font-medium text-[#0BB89A]">
                          <CircleCheck className="h-3 w-3" />
                          Confirmed
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {payment.explorerUrl ? (
                          <a
                            href={payment.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                          >
                            BaseScan
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <span className="text-xs text-white/45">Unavailable</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
