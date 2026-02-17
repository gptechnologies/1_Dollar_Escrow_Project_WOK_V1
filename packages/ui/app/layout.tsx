import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: {
    default: "Crow | Peer-to-Peer Escrow",
    template: "%s | Crow Escrow",
  },
  description: "Create escrows instantly with no sign up. Powered by Arbitrum, fees capped at $1.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Crow Escrow",
    title: "Crow | Peer-to-Peer Escrow",
    description: "The easiest way to create and settle USDC/USDT escrows on Arbitrum.",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Crow Escrow preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Crow | Peer-to-Peer Escrow",
    description: "The easiest way to create and settle USDC/USDT escrows on Arbitrum.",
    images: ["/og-image.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/scene.splinecode"
          as="fetch"
          crossOrigin="anonymous"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
