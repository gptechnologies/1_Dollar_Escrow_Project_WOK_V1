'use client';

import { useState } from 'react';
import QRCode from 'react-qr-code';
import { Copy, Check, Wallet, Loader2, ExternalLink } from 'lucide-react';
import { shortenAddress, ARBITRUM_CHAIN_ID, getArbiscanAddressUrl } from '@/lib/chain';
import { buildEIP681Uri } from '@/lib/payment';
import { useWalletConnection } from '@/lib/wallet';
import { encodeFunctionData, type Address } from 'viem';
import { ERC20ABI } from '@/lib/chain';

type PaymentLink = {
  code: string;
  wallet: string;
  token: string;
  amount: string;
  description: string | null;
  createdAt: string;
};

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1.5 rounded hover:bg-white/10 transition-colors flex items-center justify-center"
      title="Copy"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-[#0BB89A]" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-white/50 hover:text-white/80" />
      )}
    </button>
  );
}

export default function PaymentPageClient({
  link,
  tokenSymbol,
  displayAmount,
}: {
  link: PaymentLink;
  tokenSymbol: string;
  displayAmount: string;
}) {
  const wallet = useWalletConnection();
  const [paying, setPaying] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState('');

  const eip681 = buildEIP681Uri(link.token, link.wallet, link.amount);

  const handlePay = async () => {
    setError('');
    setPaying(true);

    try {
      if (!wallet.address) {
        await wallet.connect();
        return;
      }

      if (wallet.chainId !== ARBITRUM_CHAIN_ID) {
        await wallet.switchChain();
        return;
      }

      const data = encodeFunctionData({
        abi: ERC20ABI,
        functionName: 'transfer',
        args: [link.wallet as Address, BigInt(link.amount)],
      });

      const hash = await (window as any).ethereum.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: wallet.address,
            to: link.token,
            data,
          },
        ],
      });

      setTxHash(hash);
    } catch (err: any) {
      if (err?.code === 4001) {
        setError('Transaction rejected');
      } else {
        setError(err?.message || 'Transaction failed');
      }
    } finally {
      setPaying(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="surface-card p-6 max-w-sm w-full">
        {link.description && (
          <h1 className="text-lg font-semibold text-white mb-1 text-center">
            {link.description}
          </h1>
        )}

        <div className="text-center mb-5">
          <span className="text-3xl font-bold text-white">${displayAmount}</span>
          <span className="text-sm text-white/60 ml-1.5">{tokenSymbol}</span>
        </div>

        <div className="bg-white rounded-xl p-4 mx-auto w-fit mb-5">
          <QRCode value={eip681} size={200} level="M" />
        </div>

        <p className="text-xs text-white/50 text-center mb-5">
          Scan with any wallet&apos;s QR scanner to pay instantly on Arbitrum.
        </p>

        <div className="space-y-2 mb-5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50">To</span>
            <div className="flex items-center gap-1">
              <code className="font-mono text-xs text-white/80">{shortenAddress(link.wallet)}</code>
              <CopyBtn value={link.wallet} />
              <a
                href={getArbiscanAddressUrl(link.wallet)}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded hover:bg-white/10 transition-colors"
                title="View on Arbiscan"
              >
                <ExternalLink className="w-3 h-3 text-white/40 hover:text-white/70" />
              </a>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50">Token</span>
            <span className="text-xs text-white/80">{tokenSymbol} on Arbitrum</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50">Code</span>
            <div className="flex items-center gap-1">
              <code className="font-mono text-xs text-white/80">{link.code}</code>
              <CopyBtn value={link.code} />
            </div>
          </div>
        </div>

        {txHash ? (
          <div className="bg-[#0BB89A]/10 border border-[#0BB89A]/30 rounded-xl p-4 text-center">
            <p className="text-[#0BB89A] font-medium text-sm mb-1">Payment Sent</p>
            <a
              href={`https://arbiscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-white/60 hover:text-white/80 underline break-all"
            >
              View on Arbiscan
            </a>
          </div>
        ) : (
          <>
            {error && <p className="text-red-400 text-xs text-center mb-3">{error}</p>}
            <button
              onClick={handlePay}
              disabled={paying}
              className="w-full bg-[#0BB89A] hover:bg-[#0BB89A]/90 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {paying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : !wallet.address ? (
                <>
                  <Wallet className="w-4 h-4" />
                  Connect Wallet to Pay
                </>
              ) : wallet.chainId !== ARBITRUM_CHAIN_ID ? (
                'Switch to Arbitrum'
              ) : (
                `Pay $${displayAmount} ${tokenSymbol}`
              )}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
