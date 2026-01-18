'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Copy, ExternalLink, Check, ChevronDown } from 'lucide-react';
import DeadlineDateTimePicker from './DeadlineDateTimePicker';

interface CreatedEscrow {
  escrow: string;
  code: string;
  token: string;
  confirmDeadline: number;
}

// Token options - addresses will be provided by env or hardcoded for now
const TOKEN_OPTIONS = [
  { value: 'USDC', label: 'USDC', address: process.env.NEXT_PUBLIC_USDC_ADDRESS || '' },
  { value: 'USDT', label: 'USDT', address: process.env.NEXT_PUBLIC_USDT_ADDRESS || '' },
];

export default function CreateEscrowCard() {
  const [amount, setAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState('USDC');
  const [fundingAddress, setFundingAddress] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('23:59');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [arbitrator1, setArbitrator1] = useState('');
  const [arbitrator2, setArbitrator2] = useState('');
  const [arbitrator3, setArbitrator3] = useState('');  // Deadlock arbitrator
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdEscrow, setCreatedEscrow] = useState<CreatedEscrow | null>(null);
  const [copied, setCopied] = useState(false);
  const [errors, setErrors] = useState({
    amount: '',
    token: '',
    fundingAddress: '',
    counterparty: '',
    deadline: '',
    arbitrator1: '',
    arbitrator2: '',
    arbitrator3: '',
  });

  // Validate Ethereum address format
  const isValidEthAddress = (address: string) => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  const parseDeadlineDate = (dateStr: string): Date | null => {
    const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!match) return null;

    const [, month, day, yearRaw] = match;
    const yearNum = yearRaw.length === 2 ? 2000 + parseInt(yearRaw) : parseInt(yearRaw);
    const date = new Date(yearNum, parseInt(month) - 1, parseInt(day));

    if (
      date.getFullYear() !== yearNum ||
      date.getMonth() !== parseInt(month) - 1 ||
      date.getDate() !== parseInt(day)
    ) {
      return null;
    }

    return date;
  };

  // Combine date and time into a single Date object
  const combineDateTime = (date: Date | null, timeStr: string): Date | null => {
    if (!date) return null;

    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) return null;

    const [, hours, minutes] = timeMatch;

    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      parseInt(hours),
      parseInt(minutes)
    );
  };

  const validateForm = () => {
    const newErrors = {
      amount: '',
      token: '',
      fundingAddress: '',
      counterparty: '',
      deadline: '',
      arbitrator1: '',
      arbitrator2: '',
      arbitrator3: '',
    };
    let isValid = true;

    if (!amount || parseFloat(amount) <= 0) {
      newErrors.amount = 'Amount must be greater than 0';
      isValid = false;
    }

    const tokenOption = TOKEN_OPTIONS.find(t => t.value === selectedToken);
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

    const arb1 = arbitrator1.trim();
    const arb2 = arbitrator2.trim();
    const arb3 = arbitrator3.trim();

    // Enforce 0/1/3 rule: either none, only arb1, or all three
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

    if (arb1) {
      if (!isValidEthAddress(arb1)) {
        newErrors.arbitrator1 = 'Invalid Ethereum address format';
        isValid = false;
      } else if (
        arb1.toLowerCase() === fundingAddress.toLowerCase() ||
        arb1.toLowerCase() === counterparty.toLowerCase()
      ) {
        newErrors.arbitrator1 = 'Arbitrator must be different from buyer and seller';
        isValid = false;
      }
    }

    if (arb2) {
      if (!isValidEthAddress(arb2)) {
        newErrors.arbitrator2 = 'Invalid Ethereum address format';
        isValid = false;
      } else if (arb2.toLowerCase() === arb1.toLowerCase()) {
        newErrors.arbitrator2 = 'Arbitrators must be unique';
        isValid = false;
      } else if (
        arb2.toLowerCase() === fundingAddress.toLowerCase() ||
        arb2.toLowerCase() === counterparty.toLowerCase()
      ) {
        newErrors.arbitrator2 = 'Arbitrator must be different from buyer and seller';
        isValid = false;
      }
    }

    if (arb3) {
      if (!isValidEthAddress(arb3)) {
        newErrors.arbitrator3 = 'Invalid Ethereum address format';
        isValid = false;
      } else if (arb3.toLowerCase() === arb1.toLowerCase() || arb3.toLowerCase() === arb2.toLowerCase()) {
        newErrors.arbitrator3 = 'Arbitrators must be unique';
        isValid = false;
      } else if (
        arb3.toLowerCase() === fundingAddress.toLowerCase() ||
        arb3.toLowerCase() === counterparty.toLowerCase()
      ) {
        newErrors.arbitrator3 = 'Arbitrator must be different from buyer and seller';
        isValid = false;
      }
    }

    if (!deadlineDate) {
      newErrors.deadline = 'Deadline date is required';
      isValid = false;
    } else {
      const parsedDate = parseDeadlineDate(deadlineDate);
      if (!parsedDate) {
        newErrors.deadline = 'Invalid date format';
        isValid = false;
      } else {
        const combinedDateTime = combineDateTime(parsedDate, deadlineTime);
        if (!combinedDateTime) {
          newErrors.deadline = 'Invalid time format';
          isValid = false;
        } else if (combinedDateTime <= new Date()) {
          newErrors.deadline = 'Deadline must be in the future';
          isValid = false;
        }
      }
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setError('');
    setCreatedEscrow(null);

    try {
      // Get token address
      const tokenOption = TOKEN_OPTIONS.find(t => t.value === selectedToken);
      if (!tokenOption || !tokenOption.address) {
        throw new Error('Token address not configured');
      }

      // Parse amount to token units (6 decimals for USDC/USDT)
      const amountInUnits = BigInt(Math.floor(parseFloat(amount) * 1_000_000)).toString();
      
      // Combine date and time into unix timestamp
      const parsedDate = parseDeadlineDate(deadlineDate);
      if (!parsedDate) {
        setIsLoading(false);
        return;
      }
      const combinedDateTime = combineDateTime(parsedDate, deadlineTime)!;
      const deadlineTimestamp = Math.floor(combinedDateTime.getTime() / 1000);

      const arb1 = arbitrator1.trim();
      const arb2 = arbitrator2.trim();
      const arb3 = arbitrator3.trim();

      const response = await fetch('/api/escrow/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payout: counterparty,      // seller
          funder: fundingAddress,    // buyer
          token: tokenOption.address, // USDC or USDT address
          targetAmount: amountInUnits,
          deadline: deadlineTimestamp,
          ...(arb1 ? { arbitrator1: arb1 } : {}),
          ...(arb2 ? { arbitrator2: arb2 } : {}),
          ...(arb3 ? { arbitrator3: arb3 } : {}),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      
      setCreatedEscrow({
        escrow: data.escrow,
        code: data.code,
        token: data.token,
        confirmDeadline: data.confirmDeadline,
      });

    } catch (err) {
      console.error('Create escrow error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create escrow');
    } finally {
      setIsLoading(false);
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
    setShowAdvanced(false);
    setDeadlineDate('');
    setDeadlineTime('23:59');
    setErrors({
      amount: '',
      token: '',
      fundingAddress: '',
      counterparty: '',
      deadline: '',
      arbitrator1: '',
      arbitrator2: '',
      arbitrator3: '',
    });
    setError('');
  };

  const isFormValid = amount && fundingAddress && counterparty && deadlineDate && deadlineTime && parseFloat(amount) > 0;

  // Show success state with escrow address
  if (createdEscrow) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-30 w-[320px]"
      >
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-5">
          <div className="text-center mb-4">
            <div className="w-12 h-12 bg-[#0BB89A]/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <Check className="w-6 h-6 text-[#0BB89A]" />
            </div>
            <h2 className="text-lg font-bold text-white">Escrow Created!</h2>
            <p className="text-xs text-white/70 mt-1">Share this address with the seller</p>
          </div>

          {/* Escrow Address */}
          <div className="bg-white/10 rounded-lg p-3 mb-3">
            <label className="block text-xs font-semibold text-white/70 mb-1.5">
              Escrow Address
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-[#0BB89A] break-all">
                {createdEscrow.escrow}
              </code>
              <button
                onClick={copyAddress}
                className="p-1.5 hover:bg-white/10 rounded transition-colors"
                title="Copy address"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-[#0BB89A]" />
                ) : (
                  <Copy className="w-4 h-4 text-white/70" />
                )}
              </button>
            </div>
          </div>

          {/* Code */}
          <div className="bg-white/10 rounded-lg p-3 mb-3">
            <label className="block text-xs font-semibold text-white/70 mb-1.5">
              Lookup Code
            </label>
            <code className="text-sm font-mono text-white">{createdEscrow.code}</code>
          </div>

          {/* Instructions */}
          <div className="bg-[#0BB89A]/10 rounded-lg p-3 mb-4 border border-[#0BB89A]/30">
            <h3 className="text-xs font-semibold text-[#0BB89A] mb-2">Next Steps:</h3>
            <ol className="text-xs text-white/80 space-y-1.5">
              <li><span className="text-[#0BB89A] font-bold">1.</span> Seller sends exactly $1 {selectedToken} to confirm</li>
              <li><span className="text-[#0BB89A] font-bold">2.</span> Buyer sends {amount} {selectedToken} to fund</li>
              <li><span className="text-[#0BB89A] font-bold">3.</span> Seller gets paid at deadline</li>
            </ol>
          </div>

          {/* View on Arbiscan */}
          <a
            href={`https://arbiscan.io/address/${createdEscrow.escrow}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2 text-sm text-white/70 hover:text-white transition-colors"
          >
            View on Arbiscan <ExternalLink className="w-3.5 h-3.5" />
          </a>

          {/* Create Another */}
          <button
            onClick={resetForm}
            className="w-full py-2.5 px-3 rounded-lg font-semibold text-sm text-white bg-[#0BB89A] hover:bg-[#0BB89A]/90 transition-all mt-3"
          >
            Create Another Escrow
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative z-30 w-[320px]"
    >
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-5">
        <h2 className="text-lg font-bold text-white mb-3">Create Instant Escrow</h2>
        
        {error && (
          <div className="mb-3 p-2.5 bg-red-500/20 border border-red-500/50 rounded-lg">
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Amount and Token */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="amount" className="block text-xs font-semibold text-white/90 mb-1">
                Amount
              </label>
              <input
                type="number"
                id="amount"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (errors.amount) setErrors({ ...errors, amount: '' });
                }}
                placeholder="100.00"
                step="0.01"
                min="0"
                className={`w-full px-2.5 py-2 border rounded-lg focus:outline-none transition-colors bg-white/20 backdrop-blur-sm text-white text-sm placeholder:text-white/50 ${
                  errors.amount ? 'border-red-300 focus:border-red-500' : 'border-white/40 focus:border-[#0BB89A] focus:ring-2 focus:ring-[#0BB89A]/50 focus:bg-white/30'
                }`}
                required
              />
              {errors.amount && (
                <p className="mt-0.5 text-xs text-red-400">{errors.amount}</p>
              )}
            </div>
            <div className="w-24">
              <label htmlFor="token" className="block text-xs font-semibold text-white/90 mb-1">
                Token
              </label>
              <select
                id="token"
                value={selectedToken}
                onChange={(e) => {
                  setSelectedToken(e.target.value);
                  if (errors.token) setErrors({ ...errors, token: '' });
                }}
                className={`w-full px-2 py-2 border rounded-lg focus:outline-none transition-colors bg-white/20 backdrop-blur-sm text-white text-sm cursor-pointer ${
                  errors.token ? 'border-red-300 focus:border-red-500' : 'border-white/40 focus:border-[#0BB89A] focus:ring-2 focus:ring-[#0BB89A]/50 focus:bg-white/30'
                }`}
              >
                {TOKEN_OPTIONS.map((token) => (
                  <option key={token.value} value={token.value} className="bg-gray-800 text-white">
                    {token.label}
                  </option>
                ))}
              </select>
              {errors.token && (
                <p className="mt-0.5 text-xs text-red-400">{errors.token}</p>
              )}
            </div>
          </div>

          {/* Buyer Address (Funding Address) */}
          <div>
            <label htmlFor="fundingAddress" className="block text-xs font-semibold text-white/90 mb-1">
              Buyer Wallet Address (Funder)
            </label>
            <input
              type="text"
              id="fundingAddress"
              value={fundingAddress}
              onChange={(e) => {
                setFundingAddress(e.target.value);
                if (errors.fundingAddress) setErrors({ ...errors, fundingAddress: '' });
              }}
              placeholder="0x..."
              className={`w-full px-2.5 py-2 border rounded-lg focus:outline-none transition-colors font-mono text-xs bg-white/20 backdrop-blur-sm text-white placeholder:text-white/50 ${
                errors.fundingAddress ? 'border-red-300 focus:border-red-500' : 'border-white/40 focus:border-[#0BB89A] focus:ring-2 focus:ring-[#0BB89A]/50 focus:bg-white/30'
              }`}
              required
            />
            {errors.fundingAddress && (
              <p className="mt-0.5 text-xs text-red-400">{errors.fundingAddress}</p>
            )}
          </div>

          {/* Seller Address (Counterparty/Payout) */}
          <div>
            <label htmlFor="counterparty" className="block text-xs font-semibold text-white/90 mb-1">
              Seller Wallet Address (Paypout)
            </label>
            <input
              type="text"
              id="counterparty"
              value={counterparty}
              onChange={(e) => {
                setCounterparty(e.target.value);
                if (errors.counterparty) setErrors({ ...errors, counterparty: '' });
              }}
              placeholder="0x..."
              className={`w-full px-2.5 py-2 border rounded-lg focus:outline-none transition-colors font-mono text-xs bg-white/20 backdrop-blur-sm text-white placeholder:text-white/50 ${
                errors.counterparty ? 'border-red-300 focus:border-red-500' : 'border-white/40 focus:border-[#0BB89A] focus:ring-2 focus:ring-[#0BB89A]/50 focus:bg-white/30'
              }`}
              required
            />
            {errors.counterparty && (
              <p className="mt-0.5 text-xs text-red-400">{errors.counterparty}</p>
            )}
          </div>

          <DeadlineDateTimePicker
            deadline={deadlineDate}
            setDeadline={(value) => {
              setDeadlineDate(value);
              if (errors.deadline) setErrors({ ...errors, deadline: '' });
            }}
            deadlineTime={deadlineTime}
            setDeadlineTime={(value) => {
              setDeadlineTime(value);
              if (errors.deadline) setErrors({ ...errors, deadline: '' });
            }}
            error={errors.deadline}
            clearError={() => {
              if (errors.deadline) setErrors({ ...errors, deadline: '' });
            }}
          />

          {/* Advanced */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="flex w-full items-center justify-between text-xs font-semibold text-white/80 hover:text-white transition-colors"
            >
              Arbitration (optional)
              <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>

            {showAdvanced && (
              <div className="mt-2 rounded-lg border border-white/20 bg-white/10 p-2.5 space-y-2">
                <div>
                  <label htmlFor="arbitrator1" className="block text-[11px] font-semibold text-white/90 mb-1">
                    Arbitrator #1
                  </label>
                  <input
                    type="text"
                    id="arbitrator1"
                    value={arbitrator1}
                    onChange={(e) => {
                      setArbitrator1(e.target.value);
                      if (errors.arbitrator1) setErrors({ ...errors, arbitrator1: '' });
                    }}
                    placeholder="0x..."
                    className={`w-full px-2.5 py-2 border rounded-lg focus:outline-none transition-colors font-mono text-xs bg-white/20 backdrop-blur-sm text-white placeholder:text-white/50 ${
                      errors.arbitrator1 ? 'border-red-300 focus:border-red-500' : 'border-white/40 focus:border-[#0BB89A] focus:ring-2 focus:ring-[#0BB89A]/50 focus:bg-white/30'
                    }`}
                  />
                  {errors.arbitrator1 && (
                    <p className="mt-0.5 text-xs text-red-400">{errors.arbitrator1}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="arbitrator2" className="block text-[11px] font-semibold text-white/90 mb-1">
                    Arbitrator #2
                  </label>
                  <input
                    type="text"
                    id="arbitrator2"
                    value={arbitrator2}
                    onChange={(e) => {
                      setArbitrator2(e.target.value);
                      if (errors.arbitrator2) setErrors({ ...errors, arbitrator2: '' });
                    }}
                    placeholder="0x..."
                    className={`w-full px-2.5 py-2 border rounded-lg focus:outline-none transition-colors font-mono text-xs bg-white/20 backdrop-blur-sm text-white placeholder:text-white/50 ${
                      errors.arbitrator2 ? 'border-red-300 focus:border-red-500' : 'border-white/40 focus:border-[#0BB89A] focus:ring-2 focus:ring-[#0BB89A]/50 focus:bg-white/30'
                    }`}
                  />
                  {errors.arbitrator2 && (
                    <p className="mt-0.5 text-xs text-red-400">{errors.arbitrator2}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="arbitrator3" className="block text-[11px] font-semibold text-white/90 mb-1">
                    Arbitrator #3 (Deadlock Breaker)
                  </label>
                  <input
                    type="text"
                    id="arbitrator3"
                    value={arbitrator3}
                    onChange={(e) => {
                      setArbitrator3(e.target.value);
                      if (errors.arbitrator3) setErrors({ ...errors, arbitrator3: '' });
                    }}
                    placeholder="0x..."
                    className={`w-full px-2.5 py-2 border rounded-lg focus:outline-none transition-colors font-mono text-xs bg-white/20 backdrop-blur-sm text-white placeholder:text-white/50 ${
                      errors.arbitrator3 ? 'border-red-300 focus:border-red-500' : 'border-white/40 focus:border-[#0BB89A] focus:ring-2 focus:ring-[#0BB89A]/50 focus:bg-white/30'
                    }`}
                  />
                  {errors.arbitrator3 && (
                    <p className="mt-0.5 text-xs text-red-400">{errors.arbitrator3}</p>
                  )}
                </div>

                <p className="text-[10px] text-white/70">
                  Optional: 1 or 3 arbitrators. With 1 arb, their vote resolves immediately.
                  With 3 arbs, #1 and #2 must agree; if they disagree, #3 breaks the tie.
                  Unresolved disputes after the arb window are swept to treasury.
                </p>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!isFormValid || isLoading}
            className={`w-full py-2.5 px-3 rounded-lg font-semibold text-sm text-white transition-all ${
              isFormValid && !isLoading
                ? 'bg-[#0BB89A] hover:bg-[#0BB89A]/90 shadow-lg hover:shadow-xl hover:shadow-[#0BB89A]/20 backdrop-blur-sm'
                : 'bg-gray-400/50 cursor-not-allowed backdrop-blur-sm'
            }`}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Creating...
              </span>
            ) : (
              'Create Escrow'
            )}
          </button>
        </form>

        {/* Info */}
        <div className="mt-3 p-2.5 bg-white/10 rounded-lg border border-white/20 backdrop-blur-sm">
          <p className="text-[10px] text-white/80 leading-relaxed">
            <strong className="text-white">Fees:</strong> 1% fee, capped at $1. Fees are deducted from the seller payout upon resolution.
            <br />
            <strong className="text-white">Caution:</strong> ALWAYS verify escrows on Arbiscan.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
