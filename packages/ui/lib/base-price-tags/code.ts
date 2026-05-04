import { randomBytes } from 'crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function createPriceTagCode(): string {
  const bytes = randomBytes(10);
  let code = 'tag_';

  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }

  return code;
}

export function createPaymentId(): string {
  return `pay_${randomBytes(12).toString('hex')}`;
}

