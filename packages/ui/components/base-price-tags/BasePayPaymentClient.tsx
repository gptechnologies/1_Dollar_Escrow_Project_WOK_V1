'use client';

import { useEffect, useState } from 'react';
import { pay } from '@base-org/account';
import { Check, Copy, CreditCard, ExternalLink, Loader2, ShieldCheck, Wallet } from 'lucide-react';
import BrandedQRCode from '@/components/BrandedQRCode';
import type { PriceTag, PriceTagPayment } from '@/lib/base-price-tags/types';

type PaymentStep =
  | 'idle'
  | 'base_paying'
  | 'onramp_creating_session'
  | 'onramp_redirecting'
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

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

function isLikelyUserCancel(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return message.includes('cancel') || message.includes('reject') || message.includes('closed');
}

function isOnrampEligible(priceTag: PriceTag): boolean {
  return BigInt(priceTag.amountRaw) >= BigInt(5_000_000);
}

export default function BasePayPaymentClient({
  priceTag,
  initialOnrampAttemptId,
}: {
  priceTag: PriceTag;
  initialOnrampAttemptId?: string;
}) {
  const [step, setStep] = useState<PaymentStep>('idle');
  const [payment, setPayment] = useState<PriceTagPayment | null>(null);
  const [error, setError] = useState('');

  const confirmPayment = async (paymentId: string) => {
    const response = await fetch('/api/payments/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to verify payment');
    }

    setPayment(data.payment);

    if (data.payment.status === 'confirmed') {
      setStep('confirmed');
      return true;
    }

    if (data.payment.status === 'failed') {
      setStep('failed');
      setError(data.payment.failureReason || 'Payment verification failed');
      return true;
    }

    return false;
  };

  const confirmPaymentById = async (paymentId: string) => {
    const response = await fetch(`/api/payments/${paymentId}/status`, {
      method: 'POST',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to verify payment');
    }

    setPayment(data.payment);

    if (data.payment.status === 'confirmed') {
      setStep('confirmed');
      return true;
    }

    if (data.payment.status === 'failed' || data.payment.status === 'cancelled') {
      setStep(data.payment.status);
      setError(data.payment.failureReason || 'Payment was not completed');
      return true;
    }

    return false;
  };

  useEffect(() => {
    if (!initialOnrampAttemptId) {
      return;
    }

    setStep('pending');
    setError('');

    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      if (cancelled) {
        return;
      }

      attempts += 1;

      try {
        const done = await confirmPaymentById(initialOnrampAttemptId);

        if (!done && attempts < 40) {
          setTimeout(poll, 3000);
        } else if (!done) {
          setError('Payment may still be processing. Refresh this page to check again.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Payment verification failed');
      }
    };

    void poll();

    return () => {
      cancelled = true;
    };
  }, [initialOnrampAttemptId]);

  useEffect(() => {
    if (step !== 'pending' || !payment) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const interval = setInterval(async () => {
      if (cancelled) {
        clearInterval(interval);
        return;
      }

      if (attempts >= 20) {
        clearInterval(interval);
        setStep('failed');
        setError('Payment may have been submitted, but we could not confirm it automatically yet.');
        return;
      }

      attempts += 1;

      try {
        const done = await confirmPayment(payment.id);

        if (done) {
          clearInterval(interval);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Payment verification failed');
      }
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [payment, step]);

  const handlePay = async () => {
    setError('');
    setStep('base_paying');

    try {
      const result = await pay({
        amount: priceTag.amountDisplay,
        to: priceTag.recipientAddress,
        testnet: priceTag.chainId === 84532,
      });

      const response = await fetch('/api/payments/base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceTagCode: priceTag.code,
          txHash: result.id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to record payment');
      }

      setPayment(data.payment);
      setStep('pending');

      await confirmPayment(data.payment.id);
    } catch (err) {
      if (isLikelyUserCancel(err)) {
        setStep('cancelled');
        setError('Payment was cancelled. You can try again or use the card option.');
      } else {
        setStep('failed');
        setError(err instanceof Error ? err.message : 'Payment failed or was cancelled');
      }
    }
  };

  const handleOnramp = async () => {
    setError('');
    setStep('onramp_creating_session');

    try {
      const response = await fetch('/api/payments/onramp-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: priceTag.code }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start card payment');
      }

      setPayment(data.payment);
      setStep('onramp_redirecting');
      window.location.assign(data.onrampUrl);
    } catch (err) {
      setStep('failed');
      setError(err instanceof Error ? err.message : 'Could not start card payment');
    }
  };

  const busy = step === 'base_paying' || step === 'pending' || step === 'onramp_creating_session' || step === 'onramp_redirecting';
  const onrampEligible = isOnrampEligible(priceTag);

  return (
    <main className="min-h-screen relative flex items-center justify-center px-4 py-12">
      <div className="fixed inset-0 -z-10 bg-[url('/clouds.png')] bg-cover bg-center bg-no-repeat" />
      <div className="surface-card p-6 max-w-sm w-full">
        <div className="flex items-center justify-center gap-1.5 mb-4">
          <ShieldCheck className="w-4 h-4 text-[#0BB89A]" />
          <span className="text-xs text-[#0BB89A]">Direct USDC payment on {priceTag.chainName}</span>
        </div>

        <h1 className="text-lg font-semibold text-white mb-1 text-center truncate">
          {priceTag.description}
        </h1>

        <div className="text-center mb-5">
          <span className="text-3xl font-bold text-white">${priceTag.amountDisplay}</span>
          <span className="text-sm text-white/60 ml-1.5">USDC</span>
        </div>

        <div className="mb-5">
          <BrandedQRCode value={priceTag.paymentUrl} size={200} />
        </div>

        <div className="space-y-2 mb-5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50">To</span>
            <div className="flex items-center gap-1">
              <code className="font-mono text-xs text-white/80">
                {shortenAddress(priceTag.recipientAddress)}
              </code>
              <CopyButton value={priceTag.recipientAddress} label="Copy recipient" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50">Network</span>
            <span className="text-xs text-white/80">{priceTag.chainName}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50">Token</span>
            <span className="text-xs text-white/80">USDC</span>
          </div>
        </div>

        {step === 'confirmed' && payment?.txHash ? (
          <div className="bg-[#0BB89A]/10 border border-[#0BB89A]/30 rounded-xl p-4 text-center">
            <p className="text-[#0BB89A] font-medium text-sm mb-1">Payment Confirmed</p>
            <p className="text-xs text-white/60 mb-3">
              ${payment.expectedAmountDisplay} USDC sent to {shortenAddress(payment.recipientAddress)}
            </p>
            <a
              href={payment.explorerUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1 text-xs text-white/70 hover:text-white underline"
            >
              View on BaseScan
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {busy && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                <Loader2 className="w-4 h-4 text-[#0BB89A] animate-spin mx-auto mb-2" />
                <p className="text-sm text-white/80">
                  {step === 'base_paying'
                    ? 'Opening Base Pay...'
                    : step === 'onramp_creating_session'
                      ? 'Creating secure card payment...'
                      : step === 'onramp_redirecting'
                        ? 'Opening Coinbase checkout...'
                        : 'Payment sent. Waiting for confirmation...'}
                </p>
              </div>
            )}

            {error && (
              <div className="bg-amber-500/10 border border-amber-400/25 rounded-xl p-3 text-center">
                <p className="text-amber-100 text-xs leading-relaxed">
                  {error}
                  {payment?.txHash ? ' Check your wallet or open the transaction on BaseScan.' : ''}
                </p>
                {payment?.explorerUrl ? (
                  <a
                    href={payment.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center justify-center gap-1 text-xs text-white/70 hover:text-white underline"
                  >
                    View on BaseScan
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : null}
              </div>
            )}

            {priceTag.isActive ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handlePay}
                  disabled={busy}
                  className="w-full bg-[#0052FF] hover:bg-[#0052FF]/90 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {step === 'base_paying' || step === 'pending' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Wallet className="w-4 h-4" />
                      Pay with Base
                    </>
                  )}
                </button>
                <p className="text-[11px] text-white/45 text-center -mt-1">
                  Best if you already use Base or Coinbase.
                </p>

                <button
                  type="button"
                  onClick={handleOnramp}
                  disabled={busy || !onrampEligible}
                  className="w-full border border-white/15 bg-white/8 hover:bg-white/12 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {step === 'onramp_creating_session' || step === 'onramp_redirecting' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Opening checkout...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4" />
                      Pay with debit card or Apple Pay
                    </>
                  )}
                </button>
                <p className="text-[11px] text-white/45 text-center -mt-1">
                  {onrampEligible
                    ? 'For buyers who do not already have USDC.'
                    : 'Card and Apple Pay payments require a minimum of about $5.00.'}
                </p>
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                <p className="text-sm text-white/70">This price tag is inactive.</p>
              </div>
            )}

            <p className="text-[11px] text-white/45 text-center leading-relaxed">
              No Crow account required. Review the amount and recipient before confirming payment.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
