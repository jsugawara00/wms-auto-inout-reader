import Link from "next/link";
import { db } from "@/lib/db";
import { currentOperator, currentRole, clerkEnabled } from "@/lib/auth";
import { uploadPdfAction, runMailIntakeAction } from "./intake-actions";
import { switchSessionAction } from "./session-actions";

export const dynamic = "force-dynamic";

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
      <h1 className="text-xl font-bold">ダッシュボード</h1>
      {intake && (
        <p className="rounded bg-blue-50 p-2 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">
          取込結果 — {intake}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded border border-neutral-300 p-4 text-sm dark:border-neutral-700">
          <h2 className="font-bold">依頼書（PDF）をアップロード</h2>
          <p className="text-neutral-500">
            FAXをPDF化した依頼書、またはメール添付のPDFをアップロードすると、その場で読み取り、確認フォームへ届きます。
          </p>
          <form action={uploadPdfAction} className="space-y-3">
            <input
              type="file"
              name="pdfs"
              accept="application/pdf"
              multiple
              required
              className="block w-full text-sm"
            />
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
            >
              アップロードして取込
            </button>
          </form>
        </section>

        <section className="space-y-3 rounded border border-neutral-300 p-4 text-sm dark:border-neutral-700">
          <h2 className="font-bold">メール取込（手動実行）</h2>
          <p className="text-neutral-500">
            専用アドレス宛の未読メールを取り込みます。通常は毎日夕方に自動実行されます（Vercel Cron）。
            このボタンは任意のタイミングで回すためのバックアップです。
          </p>
          <form action={runMailIntakeAction}>
            <button
              type="submit"
              className="rounded border px-4 py-2 text-sm font-bold hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              メールを今すぐ取り込む
            </button>
          </form>
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
