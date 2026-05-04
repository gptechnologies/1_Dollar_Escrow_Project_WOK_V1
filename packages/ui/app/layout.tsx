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
    default: "Crow | USDC Payments",
    template: "%s | Crow",
  },
  description: "Create Base USDC price tags and Arbitrum escrows with no sign up.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Crow",
    title: "Crow | USDC Payments",
    description: "Create Base USDC price tags and Arbitrum escrows with no sign up.",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Crow Instant P2P Payments",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Crow | USDC Payments",
    description: "Create Base USDC price tags and Arbitrum escrows with no sign up.",
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
