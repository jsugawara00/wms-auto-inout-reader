import Link from "next/link";
import { db } from "@/lib/db";

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
  const counts = await getCounts();
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
    </div>
  );
}
