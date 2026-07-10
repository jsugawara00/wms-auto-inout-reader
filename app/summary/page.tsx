import Link from "next/link";
import { getDailySummary, type SummaryRow } from "@/lib/data";

export const dynamic = "force-dynamic";

// 入出庫サマリー（企画書 6.6）：本日処理した入出庫の一覧。
// 半自動読込の再確認を兼ね、担当者が俯瞰で異常に気づく最後の砦。

type Props = { searchParams: Promise<{ date?: string }> };

function todayJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function SummaryTable({ rows }: { rows: SummaryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[7%]" />
          <col className="w-[17%]" />
          <col className="w-[20%]" />
          <col className="w-[8%]" />
          <col className="w-[14%]" />
          <col className="w-[11%]" />
          <col className="w-[8%]" />
          <col className="w-[7%]" />
          <col className="w-[8%]" />
        </colgroup>
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-1 pr-3 font-normal">伝票</th>
            <th className="py-1 pr-3 font-normal">荷主</th>
            <th className="py-1 pr-3 font-normal">品名</th>
            <th className="py-1 pr-3 font-normal">規格</th>
            <th className="py-1 pr-3 font-normal">倉庫</th>
            <th className="py-1 pr-3 font-normal">製造日/ロット</th>
            <th className="py-1 pr-3 text-right font-normal">数量</th>
            <th className="py-1 pr-3 font-normal">確定者</th>
            <th className="py-1 pr-3 font-normal">確定時刻</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.slip_id}-${r.line_no}`}
              className="border-b border-neutral-100 align-top dark:border-neutral-900"
            >
              <td className="py-1 pr-3">
                <Link
                  href={`/slips/${r.slip_id}`}
                  className="font-mono text-blue-600 underline dark:text-blue-400"
                >
                  #{r.slip_id}
                </Link>
              </td>
              <td className="break-words py-1 pr-3">{r.shipper_name ?? "（未確定）"}</td>
              <td className="break-words py-1 pr-3">{r.item_name ?? r.item_name_raw}</td>
              <td className="break-words py-1 pr-3">{r.spec || "―"}</td>
              <td className="break-words py-1 pr-3">
                {r.warehouse_code ? `${r.warehouse_code} ${r.warehouse_name}` : "―"}
              </td>
              <td className="break-words py-1 pr-3 font-mono text-xs">
                {r.production_date ?? "―"}
                {r.lot_no && <span className="block">{r.lot_no}</span>}
              </td>
              <td className="py-1 pr-3 text-right font-mono">{r.quantity}</td>
              <td className="py-1 pr-3 font-mono">{r.confirmed_by}</td>
              <td className="py-1 pr-3 font-mono text-xs">
                {r.confirmed_at?.slice(11, 16)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function SummaryPage({ searchParams }: Props) {
  const { date } = await searchParams;
  const target = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date! : todayJst();
  const rows = await getDailySummary(target);
  const inbound = rows.filter((r) => r.slip_type === "inbound");
  const outbound = rows.filter((r) => r.slip_type === "outbound");

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-4">
        <h1 className="text-xl font-bold">入出庫サマリー</h1>
        <form className="flex items-center gap-2 text-sm">
          <input
            type="date"
            name="date"
            defaultValue={target}
            className="rounded border px-2 py-1 dark:bg-neutral-900"
          />
          <button
            type="submit"
            className="rounded border px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            表示
          </button>
        </form>
      </div>
      <p className="text-sm text-neutral-500">
        {target} に確定された入出庫の一覧です。読取・確定内容の再確認にお使いください（最後の砦）。
      </p>

      <section className="space-y-2">
        <h2 className="font-bold">
          入庫（{inbound.length}件）
        </h2>
        {inbound.length === 0 ? (
          <p className="text-sm text-neutral-500">この日の入庫確定はありません。</p>
        ) : (
          <SummaryTable rows={inbound} />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">
          出庫（{outbound.length}件）
        </h2>
        {outbound.length === 0 ? (
          <p className="text-sm text-neutral-500">この日の出庫確定はありません。</p>
        ) : (
          <SummaryTable rows={outbound} />
        )}
      </section>
    </div>
  );
}
