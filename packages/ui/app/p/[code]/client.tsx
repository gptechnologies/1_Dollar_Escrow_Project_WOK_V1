'use client';

import { useState, useEffect, useCallback } from 'react';
import QRCode from 'react-qr-code';
import { Copy, Check, Wallet, Loader2, ExternalLink, ShieldCheck } from 'lucide-react';
import {
  shortenAddress,
  ARBITRUM_CHAIN_ID,
  getArbiscanAddressUrl,
  PAYMENT_ROUTER_ADDRESS,
  PaymentRouterABI,
  ERC20ABI,
} from '@/lib/chain';
import { buildPaymentUrl } from '@/lib/payment';
import { useWalletConnection } from '@/lib/wallet';
import { encodeFunctionData, keccak256, toHex, toBytes, type Address } from 'viem';
import { publicClient } from '@/lib/chain';

type PaymentLink = {
  code: string;
  wallet: string;
  token: string;
  amount: string;
  description: string | null;
  onChain: boolean;
  linkId: string | null;
  createdAt: string;
};

type PayStep = 'idle' | 'approving' | 'approved' | 'paying' | 'done';

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

function deriveLinkId(code: string): `0x${string}` {
  return keccak256(toHex(toBytes(code)));
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
  const [step, setStep] = useState<PayStep>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [allowance, setAllowance] = useState<bigint>(0n);

  const linkId = link.linkId || deriveLinkId(link.code);
  const requiredAmount = BigInt(link.amount);
  const paymentUrl = buildPaymentUrl(link.code);
  const hasEnoughAllowance = allowance >= requiredAmount;
  const useRouter = link.onChain;

  const checkAllowance = useCallback(async () => {
    if (!wallet.address || !useRouter) return;
    try {
      const result = await publicClient.readContract({
        address: link.token as Address,
        abi: ERC20ABI,
        functionName: 'allowance',
        args: [wallet.address as Address, PAYMENT_ROUTER_ADDRESS as Address],
      });
      setAllowance(result as bigint);
    } catch {
      setAllowance(0n);
    }
  }, [wallet.address, link.token, useRouter]);

  useEffect(() => {
    checkAllowance();
  }, [checkAllowance]);

  const handleApprove = async () => {
    setError('');
    setStep('approving');
    try {
      const data = encodeFunctionData({
        abi: ERC20ABI,
        functionName: 'approve',
        args: [PAYMENT_ROUTER_ADDRESS as Address, requiredAmount],
      });

      await (window as any).ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: wallet.address,
          to: link.token,
          data,
        }],
      });

      // Poll for allowance update
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        await checkAllowance();
        const fresh = await publicClient.readContract({
          address: link.token as Address,
          abi: ERC20ABI,
          functionName: 'allowance',
          args: [wallet.address as Address, PAYMENT_ROUTER_ADDRESS as Address],
        }) as bigint;
        if (fresh >= requiredAmount) {
          setAllowance(fresh);
          setStep('approved');
          return;
        }
      }
      setStep('approved');
    } catch (err: any) {
      setStep('idle');
      if (err?.code === 4001) setError('Approval rejected');
      else setError(err?.message || 'Approval failed');
    }
  };

  const handlePay = async () => {
    setError('');
    setStep('paying');
    try {
      if (useRouter) {
        const data = encodeFunctionData({
          abi: PaymentRouterABI,
          functionName: 'pay',
          args: [linkId as `0x${string}`],
        });

        const hash = await (window as any).ethereum.request({
          method: 'eth_sendTransaction',
          params: [{
            from: wallet.address,
            to: PAYMENT_ROUTER_ADDRESS,
            data,
          }],
        });
        setTxHash(hash);
      } else {
        // Fallback: direct transfer for links not yet on-chain
        const data = encodeFunctionData({
          abi: ERC20ABI,
          functionName: 'transfer',
          args: [link.wallet as Address, requiredAmount],
        });

        const hash = await (window as any).ethereum.request({
          method: 'eth_sendTransaction',
          params: [{
            from: wallet.address,
            to: link.token,
            data,
          }],
        });
        setTxHash(hash);
      }
      setStep('done');
    } catch (err: any) {
      setStep(hasEnoughAllowance ? 'approved' : 'idle');
      if (err?.code === 4001) setError('Transaction rejected');
      else setError(err?.message || 'Transaction failed');
    }
  };

  const handleConnect = async () => {
    setError('');
    try {
      await wallet.connect();
    } catch (err: any) {
      setError(err?.message || 'Connection failed');
    }
  };

  const handleSwitchChain = async () => {
    setError('');
    try {
      await wallet.switchChain();
    } catch (err: any) {
      setError(err?.message || 'Chain switch failed');
    }
  };

  const isReady = wallet.address && wallet.chainId === ARBITRUM_CHAIN_ID;

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
          <QRCode value={paymentUrl} size={200} level="M" />
        </div>

        {useRouter && (
          <div className="flex items-center justify-center gap-1.5 mb-4">
            <ShieldCheck className="w-3.5 h-3.5 text-[#0BB89A]" />
            <span className="text-xs text-[#0BB89A]">
              On-chain enforced — amount and recipient are locked
            </span>
          </div>
        )}

        <p className="text-xs text-white/50 text-center mb-5">
          Scan or share this link to request payment on Arbitrum.
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

        {step === 'done' && txHash ? (
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
          <div className="space-y-2.5">
            {error && <p className="text-red-400 text-xs text-center">{error}</p>}

            {!wallet.address ? (
              <button
                onClick={handleConnect}
                className="w-full bg-[#0BB89A] hover:bg-[#0BB89A]/90 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Wallet className="w-4 h-4" />
                Connect Wallet to Pay
              </button>
            ) : wallet.chainId !== ARBITRUM_CHAIN_ID ? (
              <button
                onClick={handleSwitchChain}
                className="w-full bg-[#0BB89A] hover:bg-[#0BB89A]/90 text-white font-medium py-3 rounded-xl transition-colors"
              >
                Switch to Arbitrum
              </button>
            ) : useRouter && !hasEnoughAllowance ? (
              <button
                onClick={handleApprove}
                disabled={step === 'approving'}
                className="w-full bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {step === 'approving' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Approving...
                  </>
                ) : (
                  <>
                    Step 1: Approve ${displayAmount} {tokenSymbol}
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handlePay}
                disabled={step === 'paying'}
                className="w-full bg-[#0BB89A] hover:bg-[#0BB89A]/90 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {step === 'paying' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : useRouter ? (
                  <>
                    {hasEnoughAllowance ? 'Step 2: ' : ''}Pay ${displayAmount} {tokenSymbol}
                  </>
                ) : (
                  `Pay $${displayAmount} ${tokenSymbol}`
                )}
              </button>
            )}

            {useRouter && isReady && (
              <div className="flex justify-center gap-2 pt-1">
                <div className={`w-2 h-2 rounded-full ${hasEnoughAllowance ? 'bg-[#0BB89A]' : 'bg-white/20'}`} />
                <div className={`w-2 h-2 rounded-full ${step === 'done' ? 'bg-[#0BB89A]' : 'bg-white/20'}`} />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
