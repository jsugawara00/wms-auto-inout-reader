import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Clerk のキーが設定されていれば認証ミドルウェアを有効化し、全ページをログイン必須にする。
// 未設定（ローカル・デモ）では素通し（担当者コード＋Cookieのフォールバックで動く）。
// /api/cron/* は Vercel Cron からの呼び出しのため Clerk 保護の対象外（CRON_SECRET で認可）。

const isPublicRoute = createRouteMatcher(["/api/cron(.*)"]);

const handler = process.env.CLERK_SECRET_KEY
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublicRoute(req)) {
        await auth.protect();
      }
    })
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: [
    // Next.js 内部と静的ファイルを除く全ルート
    "/((?!_next|.*\\..*).*)",
    "/(api|trpc)(.*)",
  ],
};
