'use client';

import QRCode from 'react-qr-code';

type BrandedQRCodeProps = {
  value: string;
  size?: number;
};

export default function BrandedQRCode({ value, size = 200 }: BrandedQRCodeProps) {
  const logoSize = Math.round(size * 0.15);
  const logoPad = Math.round(logoSize * 0.15);

  return (
    <div className="bg-white rounded-xl p-4 mx-auto w-fit relative">
      <QRCode value={value} size={size} level="H" />
      <img
        src="/Crow Logo Isolated Black.png"
        alt=""
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{
          width: logoSize,
          height: logoSize,
          background: 'white',
          padding: logoPad,
          borderRadius: 4,
        }}
      />
    </div>
  );
}
