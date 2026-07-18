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
    default: "Crow | P2P Escrow on Arbitrum",
    template: "%s | Crow",
  },
  description: "Create non-custodial peer-to-peer escrows on Arbitrum with optional arbitration. No sign up.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Crow",
    title: "Crow | P2P Escrow on Arbitrum",
    description: "Create non-custodial peer-to-peer escrows on Arbitrum with optional arbitration. No sign up.",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Crow P2P Escrow",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Crow | P2P Escrow on Arbitrum",
    description: "Create non-custodial peer-to-peer escrows on Arbitrum with optional arbitration. No sign up.",
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
      <head />
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
