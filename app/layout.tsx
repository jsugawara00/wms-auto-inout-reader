import type { Metadata } from "next";
import Link from "next/link";
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
  title: "入出庫・在庫管理",
  description: "半自動 入出庫・在庫管理ツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-neutral-200 print:hidden dark:border-neutral-800">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="font-bold">
              入出庫・在庫管理
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
            <span className="ml-auto text-xs text-neutral-500">
              内容の確定は入力担当の操作で行います
            </span>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
