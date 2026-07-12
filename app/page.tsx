import Link from "next/link";
import { db } from "@/lib/db";
import { currentOperator, currentRole, clerkEnabled } from "@/lib/auth";
import { switchSessionAction } from "./session-actions";
import { UploadBox } from "./upload-box";
import { MailIntakeButton } from "./mail-intake-button";

export const dynamic = "force-dynamic";
// PDF読取（Claude API）は1件あたり数十秒かかるため、アップロード・メール取込の
// Server Action がタイムアウトしないよう上限を引き上げる（複数件の一括処理を想定）
export const maxDuration = 300;

async function getCounts() {
  const rows = await db().rows<{ status: string; cnt: number }>(
    `SELECT status, COUNT(*) AS cnt FROM slips GROUP BY status`
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = Number(r.cnt);
  return counts;
}

type Props = { searchParams: Promise<{ intake?: string }> };

export default async function Home({ searchParams }: Props) {
  const { intake } = await searchParams;
  const [counts, operator, role] = await Promise.all([
    getCounts(),
    currentOperator(),
    currentRole(),
  ]);
  const cards = [
    { label: "未処理", value: counts["unprocessed"] ?? 0, href: "/slips?status=unprocessed" },
    { label: "保留", value: counts["hold"] ?? 0, href: "/slips?status=hold" },
    { label: "完了", value: counts["done"] ?? 0, href: "/slips?status=done" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">ダッシュボード</h1>
        <Link href="/guide" className="text-sm text-blue-600 underline dark:text-blue-400">
          はじめての方へ：使い方ガイド →
        </Link>
      </div>
      {intake && (
        <p className="flex items-start gap-2 rounded bg-blue-50 p-2 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">
          <span className="flex-1">取込結果 — {intake}</span>
          <Link
            href="/"
            aria-label="この結果表示を閉じる"
            className="shrink-0 rounded px-2 font-bold hover:bg-blue-100 dark:hover:bg-blue-900"
          >
            ×
          </Link>
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded border border-neutral-300 p-4 text-sm dark:border-neutral-700">
          <h2 className="font-bold">依頼書（PDF）をアップロード</h2>
          <p className="text-neutral-500">
            FAXをPDF化した依頼書、またはメール添付のPDFをアップロードすると、その場で読み取り、確認フォームへ届きます。
          </p>
          <UploadBox />
        </section>

        <section className="space-y-3 rounded border border-neutral-300 p-4 text-sm dark:border-neutral-700">
          <h2 className="font-bold">メール取込（手動実行）</h2>
          <p className="text-neutral-500">
            専用アドレス宛の未読メールを取り込みます。通常は毎日夕方に自動実行されます（Vercel Cron）。
            このボタンは任意のタイミングで回すためのバックアップです。
          </p>
          <MailIntakeButton />
        </section>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded border border-neutral-200 p-4 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            <div className="text-sm text-neutral-500">{c.label}</div>
            <div className="text-3xl font-bold">{c.value}</div>
          </Link>
        ))}
      </div>

      <p className="text-sm text-neutral-500">
        取り込んだ依頼は「伝票（確認フォーム）」に届きます。内容を確認・修正し、確定すると在庫へ反映されます。
        確定後の在庫責任は確定者に帰属します。
      </p>

      <section className="space-y-2 rounded border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        <h2 className="font-bold">担当者・権限{clerkEnabled() ? "" : "（デモ切替）"}</h2>
        <p className="text-neutral-500">
          現在：<span className="font-mono">{operator}</span> ／ ロール{" "}
          <strong>{role === "admin" ? "admin（マスタ登録可・その場確定）" : "operator（保留＋登録依頼）"}</strong>
          。
          {clerkEnabled()
            ? "ロール・担当者コードは Clerk のユーザー属性（publicMetadata）が正です。"
            : "本番では Clerk のログインユーザー属性が正になります。"}
        </p>
        {clerkEnabled() ? null : (
        <form action={switchSessionAction} className="flex flex-wrap items-end gap-2">
          <label>
            担当者コード
            <input
              name="operator"
              defaultValue={operator}
              className="ml-1 w-28 rounded border px-2 py-1 dark:bg-neutral-900"
            />
          </label>
          <label>
            ロール
            <select
              name="role"
              defaultValue={role}
              className="ml-1 rounded border px-2 py-1 dark:bg-neutral-900"
            >
              <option value="admin">admin</option>
              <option value="operator">operator</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded border px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            切り替え
          </button>
        </form>
        )}
      </section>
    </div>
  );
}
