export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

export function buildPriceTagPaymentUrl(code: string, origin?: string): string {
  const base = origin?.replace(/\/$/, '') || getAppUrl();
  return `${base}/pay/${code}`;
}

