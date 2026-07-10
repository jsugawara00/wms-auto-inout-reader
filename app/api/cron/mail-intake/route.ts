import { NextResponse } from "next/server";
import { fetchMailIntake } from "@/lib/mail-intake";
import { notifyIntakeResults } from "@/lib/intake";

// メール取込の定期実行（追加企画 A5：Vercel Cron・夕方1日1回）。
// Hobby プランは cron が 1 日 1 回精度のため「夕方バッチ固定」と整合する。
// スケジュールは vercel.json（UTC 指定。JST 夕方 = UTC 08:00台）。
// 認可：Vercel Cron は Authorization: Bearer <CRON_SECRET> を付与する。
//       手動取込は画面のボタンが常にバックアップになる。

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const mail = await fetchMailIntake();
    if (!mail) {
      return NextResponse.json({
        ok: true,
        skipped: "メール取込は未設定（GMAIL_USER / GMAIL_APP_PASSWORD）。",
      });
    }
    await notifyIntakeResults(mail.results);
    return NextResponse.json({
      ok: true,
      count: mail.results.length,
      results: mail.results.map((r) => ({ file: r.file, result: r.result, slipId: r.slipId })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
