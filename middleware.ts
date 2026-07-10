import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Clerk のキーが設定されていれば認証ミドルウェアを有効化。
// 未設定（ローカル・デモ）では素通し（担当者コード＋Cookieのフォールバックで動く）。
const handler = process.env.CLERK_SECRET_KEY
  ? clerkMiddleware()
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: [
    // Next.js 内部と静的ファイルを除く全ルート
    "/((?!_next|.*\\..*).*)",
    "/(api|trpc)(.*)",
  ],
};
