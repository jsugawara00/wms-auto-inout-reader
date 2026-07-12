import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth";
import { AuthControls } from "./auth-controls";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "入出庫・在庫管理",
  description: "半自動 入出庫・在庫管理ツール",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-neutral-200 print:hidden dark:border-neutral-800">
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
            <Link href="/" className="font-bold">
              入出庫・在庫管理
            </Link>
            <Link href="/guide" className="hover:underline">
              使い方
            </Link>
            <Link href="/slips" className="hover:underline">
              伝票（確認フォーム）
            </Link>
            <Link href="/stock" className="hover:underline">
              在庫一覧
            </Link>
            <Link href="/summary" className="hover:underline">
              入出庫サマリー
            </Link>
            <Link href="/closing" className="hover:underline">
              月末確定
            </Link>
            <Link href="/billing" className="hover:underline">
              請求
            </Link>
            <Link href="/masters/shippers" className="hover:underline">
              荷主マスタ
            </Link>
            <Link href="/masters/items" className="hover:underline">
              商品マスタ
            </Link>
            <Link href="/masters/warehouses" className="hover:underline">
              倉庫マスタ
            </Link>
            <AuthControls />
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Clerk のキーがあれば ClerkProvider で包む。無ければ素の Shell（デモ・逃げ道）。
  if (clerkEnabled()) {
    return (
      <ClerkProvider>
        <Shell>{children}</Shell>
      </ClerkProvider>
    );
  }
  return <Shell>{children}</Shell>;
}
