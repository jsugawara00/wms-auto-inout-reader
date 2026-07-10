"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { intakePdf, notifyIntakeResults, type IntakeResult } from "@/lib/intake";
import { fetchMailIntake } from "@/lib/mail-intake";

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

  const results: IntakeResult[] = [];
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    results.push(await intakePdf(buf, file.name, "fax"));
  }
  await notifyIntakeResults(results);

  revalidatePath("/");
  revalidatePath("/slips");
  const summary = results.map((r) => `${r.file}: ${r.message}`).join(" ｜ ");
  redirect(`/?intake=${encodeURIComponent(summary)}`);
}

export async function runMailIntakeAction(): Promise<void> {
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
