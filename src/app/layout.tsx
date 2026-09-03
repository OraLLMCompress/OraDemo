import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "highlight.js/styles/github.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Ora — Compression, Live",
  description: "Side-by-side live chat comparing two model endpoints.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body>{children}</body>
    </html>
  );
}
