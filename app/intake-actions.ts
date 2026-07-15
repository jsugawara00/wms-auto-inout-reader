"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { intakePdf, notifyIntakeResults, type IntakeResult } from "@/lib/intake";
import { fetchMailIntake } from "@/lib/mail-intake";
import {
  isGuest,
  remainingGuestReads,
  consumeGuestReads,
  guestReadLimit,
} from "@/lib/guest-limit";

// 取込経路のクラウド化（追加企画§1）：
// - 画面からの PDF アップロード（即時処理）… FAXをPDF化して投入する既存フローに非侵襲で差し込む
// - メール取込の手動実行 … Vercel Cron（夕方1回）と同じ処理を任意のタイミングで回すバックアップ

export async function uploadPdfAction(formData: FormData): Promise<void> {
  const files = formData
    .getAll("pdfs")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    redirect(`/?intake=${encodeURIComponent("PDFファイルを選択してください。")}`);
  }

  // デモゲストの読取上限（入出庫あわせて5件・API濫用防止）。remaining=null は無制限（実ユーザー）。
  const remaining = await remainingGuestReads();
  if (remaining !== null && remaining <= 0) {
    redirect(
      `/?intake=${encodeURIComponent(
        `デモでお試しいただける読取（${guestReadLimit()}件）の上限に達しました。続けてお試しになりたい場合は、お問い合わせよりご連絡ください。`
      )}`
    );
  }
  const capped = remaining === null ? files : files.slice(0, remaining);
  const skipped = files.length - capped.length;

  const results: IntakeResult[] = [];
  for (const file of capped) {
    const buf = Buffer.from(await file.arrayBuffer());
    results.push(await intakePdf(buf, file.name, "fax"));
  }
  await consumeGuestReads(capped.length);
  await notifyIntakeResults(results);

  revalidatePath("/");
  revalidatePath("/slips");
  let summary = results.map((r) => `${r.file}: ${r.message}`).join(" ｜ ");
  if (skipped > 0) {
    summary += ` ｜ ⚠️ デモの読取上限（${guestReadLimit()}件）のため、残り ${skipped}件はスキップしました。`;
  }
  redirect(`/?intake=${encodeURIComponent(summary)}`);
}

export async function runMailIntakeAction(): Promise<void> {
  // デモゲストはオーナーの受信箱に接続してしまうため、メール自動取込は不可（PDFで試してもらう）。
  if (await isGuest()) {
    redirect(
      `/?intake=${encodeURIComponent(
        "メールの自動取込はデモではご利用いただけません（オーナーの受信箱に接続するため）。PDFのアップロードでお試しください。"
      )}`
    );
  }
  const mail = await fetchMailIntake();
  if (!mail) {
    redirect(
      `/?intake=${encodeURIComponent("メール取込は未設定です（環境変数 GMAIL_USER / GMAIL_APP_PASSWORD を設定してください）。")}`
    );
  }
  await notifyIntakeResults(mail.results);

  revalidatePath("/");
  revalidatePath("/slips");
  const summary =
    mail.results.length === 0
      ? "新着の入出庫メールはありませんでした。"
      : mail.results.map((r) => `${r.file}: ${r.message}`).join(" ｜ ");
  redirect(`/?intake=${encodeURIComponent(summary)}`);
}
