const USDC_DECIMALS = 6;
const DISPLAY_DECIMALS = 2;
const MIN_CENTS = BigInt(1);
const MAX_CENTS = BigInt(1_000_000); // $10,000.00

export function normalizeDisplayAmount(input: string): string {
  const trimmed = input.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error('Enter an amount with up to 2 decimal places');
  }

  const [dollarsRaw, centsRaw = ''] = trimmed.split('.');
  const dollars = dollarsRaw.replace(/^0+(?=\d)/, '') || '0';
  const cents = centsRaw.padEnd(DISPLAY_DECIMALS, '0');
  const totalCents = BigInt(dollars) * BigInt(100) + BigInt(cents);

  if (totalCents < MIN_CENTS) {
    throw new Error('Minimum amount is $0.01');
  }

  if (totalCents > MAX_CENTS) {
    throw new Error('Maximum amount is $10,000.00');
  }

  return `${totalCents / BigInt(100)}.${(totalCents % BigInt(100)).toString().padStart(2, '0')}`;
}

export function displayAmountToRaw(displayAmount: string): string {
  const normalized = normalizeDisplayAmount(displayAmount);
  const [dollars, cents] = normalized.split('.');
  const raw =
    BigInt(dollars) * BigInt(10) ** BigInt(USDC_DECIMALS) + BigInt(cents) * BigInt(10_000);

  return raw.toString();
}

export function rawAmountToDisplay(rawAmount: string): string {
  const raw = BigInt(rawAmount);
  const units = BigInt(10) ** BigInt(USDC_DECIMALS);
  const dollars = raw / units;
  const remainder = raw % units;
  const cents = remainder / BigInt(10_000);

  return `${dollars}.${cents.toString().padStart(2, '0')}`;
}

export function basePayAmountToRaw(amount: string): string {
  const trimmed = amount.trim();

  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error('Invalid Base Pay amount');
  }

  const [whole, fractional = ''] = trimmed.split('.');
  const padded = fractional.padEnd(USDC_DECIMALS, '0');

  return (BigInt(whole) * BigInt(10) ** BigInt(USDC_DECIMALS) + BigInt(padded)).toString();
}
