'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2,
  Copy,
  ExternalLink,
  Check,
  ChevronDown,
  ClipboardPaste,
  Wallet,
  CircleDollarSign,
  ArrowLeft,
} from 'lucide-react';
import { startOfDay } from 'date-fns';
import { keccak256, parseEventLogs, toBytes, type Address, type Hex } from 'viem';
import ShareModal from './ShareModal';
import DatePickerField, { dateToEndOfDayTs, parseSlashDate } from './DatePickerField';
import FieldHelpPopover from './FieldHelpPopover';
import { buildShareUrl, buildWalletShareUrls } from '@/lib/share';
import {
  ARBITRUM_CHAIN_ID,
  EscrowFactoryABI,
  getChainConfig,
  getPublicClient,
  type SupportedChainId,
} from '@/lib/chain';
import { useWalletConnection, encodeCreateEscrowTx } from '@/lib/wallet';

interface CreatedEscrow {
  escrow: string;
  code: string;
  token: string;
  txHash?: string;
  chainId: SupportedChainId;
}

const FIELD_HELP = {
  amount: 'Total Amount for the escrow',
  buyer: 'Wallet Address that will be funding the escrow',
  seller: 'Wallet Address that will receive the funds',
  settlement:
    'The resolution date. If the escrow is fully funded by 11:59 PM on this date it can be released to the seller (or resolved by arbitrators); if it is underfunded it can be refunded to the buyer.',
} as const;

const TOKEN_OPTIONS = ['USDC', 'USDT'] as const;

type CreateEscrowCardProps = {
  className?: string;
  chainId?: SupportedChainId;
  initialValues?: {
    amount?: string;
    token?: string;
    funder?: string;
    payout?: string;
    deadlineDate?: string;
    deadlineTime?: string;
  };
};

type CreateStep = 'form' | 'signing' | 'confirming' | 'registering';

const emptyErrors = {
  amount: '',
  token: '',
  fundingAddress: '',
  counterparty: '',
  settlementDate: '',
  arbitrator1: '',
  arbitrator2: '',
  arbitrator3: '',
};

function FieldLabel({
  htmlFor,
  label,
  help,
}: {
  htmlFor?: string;
  label: string;
  help: string;
}) {
  return (
    <label htmlFor={htmlFor} className="rune-frow-label rune-frow-label-with-help">
      <span>{label}</span>
      <FieldHelpPopover label={label} description={help} />
    </label>
  );
}

export default function CreateEscrowCard({
  className = 'w-[320px]',
  chainId = ARBITRUM_CHAIN_ID,
  initialValues,
}: CreateEscrowCardProps) {
  const chainConfig = getChainConfig(chainId);
  const wallet = useWalletConnection(chainId);
  const [amount, setAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState('USDC');
  const [fundingAddress, setFundingAddress] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [settlementDate, setSettlementDate] = useState<Date | undefined>();
  const [arbitratorsOpen, setArbitratorsOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsText, setTermsText] = useState('');
  const [arbitrator1, setArbitrator1] = useState('');
  const [arbitrator2, setArbitrator2] = useState('');
  const [arbitrator3, setArbitrator3] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>('form');
  const [error, setError] = useState('');
  const [createdEscrow, setCreatedEscrow] = useState<CreatedEscrow | null>(null);
  const [copied, setCopied] = useState(false);
  const [errors, setErrors] = useState({ ...emptyErrors });
  const todayStart = startOfDay(new Date());

  useEffect(() => {
    if (!initialValues) return;
    if (initialValues.amount) setAmount(initialValues.amount);
    if (initialValues.token && TOKEN_OPTIONS.some((token) => token === initialValues.token)) {
      setSelectedToken(initialValues.token);
    }
    if (initialValues.funder) setFundingAddress(initialValues.funder);
    if (initialValues.payout) setCounterparty(initialValues.payout);
    if (initialValues.deadlineDate) {
      const parsed = parseSlashDate(initialValues.deadlineDate);
      if (parsed) setSettlementDate(parsed);
    }
  }, [initialValues]);

  const pasteFromClipboard = async (setter: (value: string) => void, errorKey: keyof typeof errors) => {
    try {
      const text = await navigator.clipboard.readText();
      setter(text.trim());
      if (errors[errorKey]) setErrors({ ...errors, [errorKey]: '' });
    } catch {
      /* clipboard unavailable */
    }
  };

  const isValidEthAddress = (address: string) => /^0x[a-fA-F0-9]{40}$/.test(address);

  const validateForm = () => {
    const newErrors = { ...emptyErrors };
    let isValid = true;
    const nowTs = Math.floor(Date.now() / 1000);

    if (!amount || parseFloat(amount) < 1) {
      newErrors.amount = 'Amount must be at least $1';
      isValid = false;
    }

    const tokenOption = chainConfig.tokens[selectedToken as keyof typeof chainConfig.tokens];
    if (!tokenOption || !tokenOption.address) {
      newErrors.token = 'Token address not configured';
      isValid = false;
    }

    if (!fundingAddress) {
      newErrors.fundingAddress = 'Buyer address is required';
      isValid = false;
    } else if (!isValidEthAddress(fundingAddress)) {
      newErrors.fundingAddress = 'Invalid Ethereum address format';
      isValid = false;
    }

    if (!counterparty) {
      newErrors.counterparty = 'Seller address is required';
      isValid = false;
    } else if (!isValidEthAddress(counterparty)) {
      newErrors.counterparty = 'Invalid Ethereum address format';
      isValid = false;
    }

    if (fundingAddress && counterparty && fundingAddress.toLowerCase() === counterparty.toLowerCase()) {
      newErrors.counterparty = 'Buyer and seller must be different';
      isValid = false;
    }

    const settlementTs = settlementDate ? dateToEndOfDayTs(settlementDate) : null;
    if (!settlementDate) {
      newErrors.settlementDate = 'Settlement date is required';
      isValid = false;
    } else if (settlementTs !== null && settlementTs <= nowTs) {
      newErrors.settlementDate = 'Settlement date must be today or later';
      isValid = false;
    } else if (settlementTs !== null && settlementTs > nowTs + 365 * 24 * 60 * 60) {
      newErrors.settlementDate = 'Settlement date cannot be more than a year away';
      isValid = false;
    }

    const arb1 = arbitrator1.trim();
    const arb2 = arbitrator2.trim();
    const arb3 = arbitrator3.trim();
    const hasArb1 = !!arb1;
    const hasArb2 = !!arb2;
    const hasArb3 = !!arb3;

    if (hasArb2 || hasArb3) {
      if (!hasArb1 || !hasArb2 || !hasArb3) {
        if (!hasArb1) newErrors.arbitrator1 = 'All 3 arbitrators required for 3-arb setup';
        if (!hasArb2) newErrors.arbitrator2 = 'All 3 arbitrators required for 3-arb setup';
        if (!hasArb3) newErrors.arbitrator3 = 'All 3 arbitrators required for 3-arb setup';
        isValid = false;
      }
    }

    const checkArb = (val: string, key: 'arbitrator1' | 'arbitrator2' | 'arbitrator3', others: string[]) => {
      if (!val) return;
      if (!isValidEthAddress(val)) {
        newErrors[key] = 'Invalid Ethereum address format';
        isValid = false;
      } else if (val.toLowerCase() === fundingAddress.toLowerCase() || val.toLowerCase() === counterparty.toLowerCase()) {
        newErrors[key] = 'Arbitrator must differ from buyer and seller';
        isValid = false;
      } else if (others.some((o) => o && o.toLowerCase() === val.toLowerCase())) {
        newErrors[key] = 'Arbitrators must be unique';
        isValid = false;
      }
    };
    checkArb(arb1, 'arbitrator1', [arb2, arb3]);
    checkArb(arb2, 'arbitrator2', [arb1, arb3]);
    checkArb(arb3, 'arbitrator3', [arb1, arb2]);

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    if (!wallet.address) {
      try {
        await wallet.connect();
      } catch {
        setError('Please connect your wallet to create an escrow');
      }
      return;
    }

    setIsLoading(true);
    setError('');
    setCreatedEscrow(null);
    setCreateStep('signing');

    try {
      const tokenOption = chainConfig.tokens[selectedToken as keyof typeof chainConfig.tokens];
      if (!tokenOption || !tokenOption.address) {
        throw new Error('Token address not configured');
      }

      const amountInUnits = BigInt(Math.floor(parseFloat(amount) * 1_000_000));
      const settlementTs = dateToEndOfDayTs(settlementDate!);

      const normalizedTerms = termsText.trim();
      const termsHash: Hex | undefined = normalizedTerms ? keccak256(toBytes(normalizedTerms)) : undefined;

      const arb1 = arbitrator1.trim() || undefined;
      const arb2 = arbitrator2.trim() || undefined;
      const arb3 = arbitrator3.trim() || undefined;

      const txData = encodeCreateEscrowTx({
        payout: counterparty as Address,
        funder: fundingAddress as Address,
        token: tokenOption.address as Address,
        targetAmount: amountInUnits,
        settlementDate: settlementTs,
        termsHash,
        arbitrator1: arb1 as Address | undefined,
        arbitrator2: arb2 as Address | undefined,
        arbitrator3: arb3 as Address | undefined,
      });

      const txHash = await new Promise<string>((resolve, reject) => {
        if (!window.ethereum || !wallet.address) {
          reject(new Error('Wallet not connected'));
          return;
        }
        window.ethereum
          .request({
            method: 'eth_sendTransaction',
            params: [{ from: wallet.address, to: chainConfig.factoryAddress, data: txData }],
          })
          .then((hash) => resolve(hash as string))
          .catch(reject);
      });

      setCreateStep('confirming');
      const receipt = await getPublicClient(chainId).waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      if (receipt.status === 'reverted') {
        throw new Error('Transaction reverted on chain');
      }

      const logs = parseEventLogs({ abi: EscrowFactoryABI, logs: receipt.logs, eventName: 'EscrowCreated' });
      if (logs.length === 0) {
        throw new Error('EscrowCreated event not found in receipt');
      }

      const event = logs[0].args;
      const escrowAddress = event.escrow as string;
      const tokenAddress = event.token as string;

      setCreateStep('registering');
      const registerResp = await fetch('/api/escrow/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainId, txHash, termsText: normalizedTerms || undefined }),
      });

      let code = '';
      if (registerResp.ok) {
        const regData = await registerResp.json();
        code = regData.code || '';
      } else {
        console.warn('Register failed, escrow created on-chain but not indexed yet');
      }

      setCreatedEscrow({ escrow: escrowAddress, code, token: tokenAddress, txHash, chainId });
    } catch (err: unknown) {
      console.error('Create escrow error:', err);
      const errObj = err as { code?: number; message?: string };
      if (errObj.code === 4001) {
        setError('Transaction rejected by user');
      } else {
        setError(errObj.message || 'Failed to create escrow');
      }
    } finally {
      setIsLoading(false);
      setCreateStep('form');
    }
  };

  const copyAddress = () => {
    if (createdEscrow) {
      navigator.clipboard.writeText(createdEscrow.escrow);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const resetForm = () => {
    setCreatedEscrow(null);
    setAmount('');
    setSelectedToken('USDC');
    setFundingAddress('');
    setCounterparty('');
    setArbitrator1('');
    setArbitrator2('');
    setArbitrator3('');
    setTermsText('');
    setSettlementDate(undefined);
    setArbitratorsOpen(false);
    setTermsOpen(false);
    setErrors({ ...emptyErrors });
    setError('');
  };

  const isFormValid =
    amount && fundingAddress && counterparty && settlementDate && parseFloat(amount) >= 1;

  if (createdEscrow) {
    const hasCode = !!createdEscrow.code;
    const confirmShareUrl = hasCode ? buildShareUrl(createdEscrow.code, { action: 'sellerConfirm', role: 'seller' }) : '';
    const confirmWalletUrls = hasCode
      ? buildWalletShareUrls(createdEscrow.code, { action: 'sellerConfirm', role: 'seller' })
      : { metamask: '', coinbase: '' };
    const fundShareUrl = hasCode ? buildShareUrl(createdEscrow.code, { action: 'fund', role: 'buyer' }) : '';
    const fundWalletUrls = hasCode
      ? buildWalletShareUrls(createdEscrow.code, { action: 'fund', role: 'buyer' })
      : { metamask: '', coinbase: '' };

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className={`relative z-30 ${className}`}
      >
        <div className="surface-card rune-create-card p-5">
          <div className="text-center mb-4">
            <div className="w-12 h-12 bg-[#0BB89A]/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <Check className="w-6 h-6 text-[#0BB89A]" />
            </div>
            <h2 className="text-lg font-bold text-white">Escrow Created!</h2>
            <p className="text-xs text-white/70 mt-1">
              Next: the buyer funds it, then the seller confirms.
            </p>
          </div>

          <div className="bg-white/10 rounded-lg p-3 mb-3">
            <label className="block text-xs font-semibold text-white/70 mb-1.5">Escrow Address</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-[#0BB89A] break-all">{createdEscrow.escrow}</code>
              <button onClick={copyAddress} className="p-1.5 hover:bg-white/10 rounded transition-colors" title="Copy address">
                {copied ? <Check className="w-4 h-4 text-[#0BB89A]" /> : <Copy className="w-4 h-4 text-white/70" />}
              </button>
            </div>
          </div>

          {hasCode && (
            <div className="bg-white/10 rounded-lg p-3 mb-3">
              <label className="block text-xs font-semibold text-white/70 mb-1.5">Lookup Code</label>
              <code className="text-sm font-mono text-white">{createdEscrow.code}</code>
            </div>
          )}

          {!hasCode && (
            <div className="bg-yellow-500/10 rounded-lg p-3 mb-3 border border-yellow-500/30">
              <p className="text-xs text-yellow-300">
                Escrow created on-chain but registration is pending. The watcher will index it shortly.
              </p>
            </div>
          )}

          <div className="bg-[#0BB89A]/10 rounded-lg p-3 mb-4 border border-[#0BB89A]/30">
            <h3 className="text-xs font-semibold text-[#0BB89A] mb-2">What should happen next</h3>
            <ol className="text-xs text-white/80 space-y-1.5">
              <li><span className="text-[#0BB89A] font-bold">1.</span> Buyer funds {amount} {selectedToken} into the escrow.</li>
              <li><span className="text-[#0BB89A] font-bold">2.</span> Seller confirms to activate the escrow.</li>
              <li><span className="text-[#0BB89A] font-bold">3.</span> After the settlement date, funds release to the seller.</li>
            </ol>
          </div>

          {hasCode && (
            <div className="grid grid-cols-1 gap-2 mb-3">
              <p className="text-[11px] text-white/65">Buyer: share this so they can fund the escrow.</p>
              <ShareModal
                shareUrl={fundShareUrl}
                walletUrls={fundWalletUrls}
                title="Share funding link"
                description="Send to the buyer to fund this escrow."
                triggerLabel="Share buyer funding link"
                triggerClassName="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 transition-colors"
              />
              <p className="text-[11px] text-white/65 mt-1">Seller: share this so they can confirm once funded.</p>
              <ShareModal
                shareUrl={confirmShareUrl}
                walletUrls={confirmWalletUrls}
                title="Share confirm link"
                description="Send to the seller to confirm the escrow."
                triggerLabel="Share seller confirm link"
                triggerClassName="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 transition-colors"
              />
            </div>
          )}

          <a
            href={`${getChainConfig(createdEscrow.chainId).explorerBaseUrl}/address/${createdEscrow.escrow}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2 text-sm text-white/70 hover:text-white transition-colors"
          >
            View on {getChainConfig(createdEscrow.chainId).chainId === 1 ? 'Etherscan' : 'Arbiscan'} <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            onClick={resetForm}
            className="w-full py-2.5 px-3 rounded-lg font-semibold text-sm text-white bg-[#0BB89A] hover:bg-[#0BB89A]/90 active:scale-[0.99] transition-all mt-3"
          >
            Create Another Escrow
          </button>
        </div>
      </motion.div>
    );
  }

  const arbFields = [
    { id: 'arbitrator1' as const, label: 'Arbitrator 1', value: arbitrator1, set: setArbitrator1, err: errors.arbitrator1 },
    { id: 'arbitrator2' as const, label: 'Arbitrator 2', value: arbitrator2, set: setArbitrator2, err: errors.arbitrator2 },
    { id: 'arbitrator3' as const, label: 'Arbitrator 3', value: arbitrator3, set: setArbitrator3, err: errors.arbitrator3 },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={`relative z-30 ${className}`}
    >
      <div className="surface-card rune-create-card">
        {error && (
          <div className="rune-create-error">
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="rune-cform">
          {/* Amount + token */}
          <div className="rune-frow rune-frow-full">
            <FieldLabel htmlFor="amount" label="Amount" help={FIELD_HELP.amount} />
            <div className="rune-frow-control">
              <div className="rune-amount-control">
                <input
                  type="number"
                  id="amount"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (errors.amount) setErrors({ ...errors, amount: '' });
                  }}
                  placeholder="0.00"
                  step="0.01"
                  min="1"
                  className="rune-input"
                  required
                />
                <div className="rune-token">
                  <CircleDollarSign size={15} />
                  <span className="rune-token-value" aria-hidden>{selectedToken}</span>
                  <select
                    id="token"
                    value={selectedToken}
                    onChange={(e) => {
                      setSelectedToken(e.target.value);
                      if (errors.token) setErrors({ ...errors, token: '' });
                    }}
                    aria-label="Token"
                  >
                    {TOKEN_OPTIONS.map((token) => (
                      <option key={token} value={token}>
                        {token}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </div>
              {(errors.amount || errors.token) && (
                <p className="rune-field-error">{errors.amount || errors.token}</p>
              )}
            </div>
          </div>

          {/* Buyer */}
          <div className="rune-frow">
            <FieldLabel htmlFor="fundingAddress" label="Buyer Address" help={FIELD_HELP.buyer} />
            <div className="rune-frow-control">
              <div className="rune-input-wrap">
                <input
                  type="text"
                  id="fundingAddress"
                  value={fundingAddress}
                  onChange={(e) => {
                    setFundingAddress(e.target.value);
                    if (errors.fundingAddress) setErrors({ ...errors, fundingAddress: '' });
                  }}
                  placeholder="0x..."
                  className="rune-input rune-input-mono"
                  required
                />
                <button
                  type="button"
                  onClick={() => pasteFromClipboard(setFundingAddress, 'fundingAddress')}
                  title="Paste from clipboard"
                  aria-label="Paste buyer address"
                >
                  <ClipboardPaste className="w-4 h-4" />
                </button>
              </div>
              {errors.fundingAddress && <p className="rune-field-error">{errors.fundingAddress}</p>}
            </div>
          </div>

          {/* Seller */}
          <div className="rune-frow">
            <FieldLabel htmlFor="counterparty" label="Seller Address" help={FIELD_HELP.seller} />
            <div className="rune-frow-control">
              <div className="rune-input-wrap">
                <input
                  type="text"
                  id="counterparty"
                  value={counterparty}
                  onChange={(e) => {
                    setCounterparty(e.target.value);
                    if (errors.counterparty) setErrors({ ...errors, counterparty: '' });
                  }}
                  placeholder="0x..."
                  className="rune-input rune-input-mono"
                  required
                />
                <button
                  type="button"
                  onClick={() => pasteFromClipboard(setCounterparty, 'counterparty')}
                  title="Paste from clipboard"
                  aria-label="Paste seller address"
                >
                  <ClipboardPaste className="w-4 h-4" />
                </button>
              </div>
              {errors.counterparty && <p className="rune-field-error">{errors.counterparty}</p>}
            </div>
          </div>

          {/* Settlement Date */}
          <div className="rune-frow">
            <FieldLabel label="Settlement Date" help={FIELD_HELP.settlement} />
            <div className="rune-frow-control">
              <DatePickerField
                id="settlementDate"
                value={settlementDate}
                onChange={(date) => {
                  setSettlementDate(date);
                  if (errors.settlementDate) setErrors({ ...errors, settlementDate: '' });
                }}
                placeholder="Select settlement date"
                minDate={todayStart}
              />
              {errors.settlementDate && <p className="rune-field-error">{errors.settlementDate}</p>}
            </div>
          </div>

          {/* Optional Arbitrators (collapsible) */}
          <div className="rune-frow rune-frow-full rune-arb-section">
            <button
              type="button"
              className="rune-arb-toggle"
              onClick={() => setArbitratorsOpen((open) => !open)}
              aria-expanded={arbitratorsOpen}
              aria-controls="arbitrators-body"
            >
              <span className="rune-arb-toggle-label">
                Optional Arbitrators <small>(up to 3)</small>
              </span>
              <ChevronDown size={18} className={`rune-arb-chevron${arbitratorsOpen ? ' open' : ''}`} aria-hidden />
            </button>
            {arbitratorsOpen && (
              <div className="rune-arb-body" id="arbitrators-body">
                <div className="rune-arb-list">
                  {arbFields.map((field) => (
                    <div className="rune-arb-row" key={field.id}>
                      <span className="rune-arb-label">{field.label}</span>
                      <div className="rune-input-wrap">
                        <input
                          type="text"
                          id={field.id}
                          value={field.value}
                          onChange={(e) => {
                            field.set(e.target.value);
                            if (errors[field.id]) setErrors({ ...errors, [field.id]: '' });
                          }}
                          placeholder="0x..."
                          className="rune-input rune-input-mono"
                        />
                        <button
                          type="button"
                          onClick={() => pasteFromClipboard(field.set, field.id)}
                          title="Paste from clipboard"
                          aria-label={`Paste ${field.label}`}
                        >
                          <ClipboardPaste className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {(errors.arbitrator1 || errors.arbitrator2 || errors.arbitrator3) && (
                    <p className="rune-field-error">
                      {errors.arbitrator1 || errors.arbitrator2 || errors.arbitrator3}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Terms (collapsible) */}
          <div className="rune-frow rune-frow-full rune-arb-section rune-terms-section">
            <button
              type="button"
              className="rune-arb-toggle"
              onClick={() => setTermsOpen((open) => !open)}
              aria-expanded={termsOpen}
              aria-controls="terms-body"
            >
              <span className="rune-arb-toggle-label">
                Terms / Description <small>(optional)</small>
              </span>
              <ChevronDown size={18} className={`rune-arb-chevron${termsOpen ? ' open' : ''}`} aria-hidden />
            </button>
            {termsOpen && (
              <div className="rune-arb-body rune-terms-body" id="terms-body">
                <textarea
                  id="termsText"
                  value={termsText}
                  onChange={(e) => setTermsText(e.target.value)}
                  placeholder="e.g., Deliver product, quality checks, payment terms..."
                  className="rune-input rune-textarea"
                  rows={3}
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="rune-cform-footer rune-frow-full">
            <button
              type="button"
              onClick={resetForm}
              className="rune-cform-back"
              title="Clear form"
              aria-label="Clear form"
            >
              <ArrowLeft size={18} />
            </button>
            {!wallet.address ? (
              <button type="button" onClick={() => wallet.connect()} className="rune-cform-submit">
                <Wallet className="w-4 h-4" />
                Connect Wallet to Create
              </button>
            ) : wallet.chainId !== chainId ? (
              <button type="button" onClick={() => wallet.switchChain()} className="rune-cform-submit">
                Switch to {chainConfig.shortName}
              </button>
            ) : (
              <button
                type="submit"
                disabled={!isFormValid || isLoading}
                className="rune-cform-submit"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {createStep === 'signing' && 'Sign in wallet...'}
                    {createStep === 'confirming' && 'Confirming on chain...'}
                    {createStep === 'registering' && 'Registering escrow...'}
                  </span>
                ) : (
                  'Create Escrow'
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </motion.div>
  );
}
