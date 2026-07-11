import Link from "next/link";
import { listSlips } from "@/lib/data";
import type { SlipStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  unprocessed: "未処理",
  confirmed: "確認済",
  done: "完了",
  hold: "保留",
};

const TYPE_LABEL = { inbound: "入庫", outbound: "出庫" } as const;
const SOURCE_LABEL = { fax: "FAX", mail: "メール" } as const;

type Props = { searchParams: Promise<{ status?: string }> };

function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function SlipsPage({ searchParams }: Props) {
  const { status } = await searchParams;
  const valid: SlipStatus[] = ["unprocessed", "confirmed", "done", "hold"];
  const filter = valid.includes(status as SlipStatus) ? (status as SlipStatus) : undefined;
  const slips = await listSlips(filter);
  const today = todayJst();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">伝票（確認フォーム）</h1>
      <div className="flex gap-2 text-sm">
        <Link
          href="/slips"
          className={`rounded border px-3 py-1 ${!filter ? "bg-neutral-200 dark:bg-neutral-700" : ""}`}
        >
          すべて
        </Link>
        {valid.map((s) => (
          <Link
            key={s}
            href={`/slips?status=${s}`}
            className={`rounded border px-3 py-1 ${filter === s ? "bg-neutral-200 dark:bg-neutral-700" : ""}`}
          >
            {STATUS_LABEL[s]}
          </Link>
        ))}
      </div>
      {slips.length === 0 ? (
        <p className="text-sm text-neutral-500">該当する伝票はありません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">区分</th>
                <th className="py-2 pr-3">状態</th>
                <th className="py-2 pr-3">荷主</th>
                <th className="py-2 pr-3">伝票番号</th>
                <th className="py-2 pr-3">入出庫日</th>
                <th className="py-2 pr-3">明細</th>
                <th className="py-2 pr-3">形式</th>
                <th className="py-2 pr-3">読取確信度</th>
                <th className="py-2 pr-3">取込日時</th>
              </tr>
            </thead>
            <tbody>
              {slips.map((s) => (
                <tr key={s.id} className="border-b hover:bg-neutral-50 dark:hover:bg-neutral-900">
                  <td className="py-2 pr-3">
                    <Link href={`/slips/${s.id}`} className="font-mono text-blue-600 underline dark:text-blue-400">
                      {s.id}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{TYPE_LABEL[s.slip_type]}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        s.status === "unprocessed"
                          ? "text-amber-600"
                          : s.status === "hold"
                            ? "text-red-600"
                            : "text-neutral-500"
                      }
                    >
                      {STATUS_LABEL[s.status]}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{s.shipper_name ?? "（未確定）"}</td>
                  <td className="py-2 pr-3 font-mono">{s.slip_number || "―"}</td>
                  <td className="py-2 pr-3 font-mono">
                    {s.movement_date ? (
                      <span
                        className={
                          s.status !== "done" && s.movement_date !== today
                            ? "font-bold text-red-600"
                            : ""
                        }
                      >
                        {s.movement_date}
                      </span>
                    ) : (
                      "―"
                    )}
                  </td>
                  <td className="py-2 pr-3">{s.line_count}行</td>
                  <td className="py-2 pr-3">{SOURCE_LABEL[s.source_type]}</td>
                  <td className="py-2 pr-3">
                    {s.confidence === "low" ? (
                      <span className="text-red-600">低（要確認）</span>
                    ) : (
                      (s.confidence ?? "―")
                    )}
                  </td>
                  <td className="py-2 pr-3">{s.received_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
