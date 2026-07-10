import { Fragment } from "react";
import Link from "next/link";
import {
  getSnapshot,
  listSnapshotMonths,
  getOverrideHistory,
  effectiveQuantity,
  type SnapshotRow,
} from "@/lib/closing";
import { finalizeMonthAction, overrideSnapshotAction } from "./actions";

export const dynamic = "force-dynamic";

// 月末在庫の確定・閲覧・表示値修正（企画書 6.6 ＋ 現場要件）
// 印刷（Ctrl+P）時は一覧表のみが出力される体裁（メニュー・フォーム・修正履歴は print:hidden）。

type Props = { searchParams: Promise<{ month?: string; saved?: string; error?: string }> };

function currentMonthJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 7);
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const day = new Date(y, m, 0).getDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

function SnapshotTable(props: { rows: SnapshotRow[]; month: string }) {
  const { rows, month } = props;
  const byShipper = new Map<string, SnapshotRow[]>();
  for (const r of rows) {
    const list = byShipper.get(r.shipper_name) ?? [];
    list.push(r);
    byShipper.set(r.shipper_name, list);
  }
  return (
    <div className="space-y-4">
      {[...byShipper.entries()].map(([shipperName, items]) => (
        <section key={shipperName} className="space-y-1">
          <h3 className="border-b pb-1 font-bold">{shipperName}</h3>
          <table className="w-full min-w-[680px] table-fixed border-collapse text-sm print:min-w-0">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
              <col className="w-[13%]" />
              <col className="w-[13%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-1 pr-3 font-normal">品名</th>
                <th className="py-1 pr-3 font-normal">規格</th>
                <th className="py-1 pr-3 font-normal">倉庫</th>
                <th className="py-1 pr-3 font-normal">製造日</th>
                <th className="py-1 pr-3 font-normal">ロット</th>
                <th className="py-1 pr-3 font-normal">特定番号</th>
                <th className="py-1 pr-3 text-right font-normal">数量</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const qty = effectiveQuantity(r);
                return (
                  <Fragment key={r.id}>
                    <tr className="border-b border-neutral-100 dark:border-neutral-900">
                      <td className="break-words py-1 pr-3">{r.item_name}</td>
                      <td className="break-words py-1 pr-3">{r.spec || "―"}</td>
                      <td className="py-1 pr-3">{r.warehouse_code}</td>
                      <td className="py-1 pr-3">{r.production_date ?? "―"}</td>
                      <td className="break-words py-1 pr-3 font-mono">{r.lot_no || "―"}</td>
                      <td className="break-words py-1 pr-3 font-mono">{r.order_no || "―"}</td>
                      <td
                        className={`py-1 pr-3 text-right font-mono ${Number(qty) < 0 ? "font-bold text-red-600" : ""}`}
                      >
                        {qty}
                        {r.override_quantity !== null && (
                          <span className="block text-xs text-amber-600 print:hidden">
                            修正済（原本 {r.quantity}）
                          </span>
                        )}
                      </td>
                    </tr>
                    <tr className="print:hidden">
                      <td colSpan={7} className="pb-2">
                        <details>
                          <summary className="cursor-pointer text-xs text-blue-600 hover:underline dark:text-blue-400">
                            表示値を修正する（原本は不変）
                          </summary>
                          <form
                            action={overrideSnapshotAction}
                            className="mt-2 flex flex-wrap items-end gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-700 dark:bg-amber-950"
                          >
                            <input type="hidden" name="month" value={month} />
                            <input type="hidden" name="snapshotId" value={r.id} />
                            <label>
                              表示数量
                              <input
                                type="number"
                                step="0.001"
                                name="overrideQuantity"
                                defaultValue={qty}
                                required
                                className="ml-1 w-28 rounded border px-1 py-0.5 dark:bg-neutral-900"
                              />
                            </label>
                            <label className="flex-1">
                              修正理由（必須）
                              <input
                                name="reason"
                                required
                                placeholder="例：メーカー様帳簿との突合により（先方入力漏れ）"
                                className="ml-1 w-2/3 rounded border px-1 py-0.5 dark:bg-neutral-900"
                              />
                            </label>
                            <button
                              type="submit"
                              className="rounded border border-amber-500 px-3 py-1 font-bold text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
                            >
                              表示値を修正
                            </button>
                          </form>
                        </details>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

export default async function ClosingPage({ searchParams }: Props) {
  const { month, saved, error } = await searchParams;
  const months = await listSnapshotMonths();

  const selected = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : null;
  const [snapshot, overrides] = selected
    ? await Promise.all([getSnapshot(selected), getOverrideHistory(selected)])
    : [[], []];
  const meta = selected ? months.find((m) => m.snapshot_month === selected) : undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold print:hidden">月末在庫の確定</h1>

      {saved && (
        <p className="rounded bg-green-50 p-2 text-sm text-green-700 print:hidden dark:bg-green-950 dark:text-green-300">
          {saved}
        </p>
      )}
      {error && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-700 print:hidden dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <section className="space-y-3 rounded border border-neutral-300 p-4 text-sm print:hidden dark:border-neutral-700">
        <h2 className="font-bold">月末確定を実行</h2>
        <p className="text-neutral-500">
          現在の在庫残高（数量0を除く）を、指定月の月末在庫として確定・保存します。
          確定した残高が翌月の期首になります。品名・荷主名は確定時点の内容で固定され、後からマスタを変えても月末表は変わりません。
        </p>
        <form action={finalizeMonthAction} className="space-y-3">
          <label className="block">
            対象月
            <input
              type="month"
              name="month"
              defaultValue={currentMonthJst()}
              required
              className="ml-2 rounded border px-2 py-1 dark:bg-neutral-900"
            />
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="acknowledged" className="mt-1" />
            <span>
              この残高で月末在庫を確定します。<strong>確定後の月末表（原本）は不変</strong>であり、確定の責任は確定者に帰属することを理解しています。
            </span>
          </label>
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700"
          >
            月末在庫を確定する
          </button>
        </form>
      </section>

      <section className="space-y-2 print:hidden">
        <h2 className="font-bold">確定済みの月</h2>
        {months.length === 0 ? (
          <p className="text-sm text-neutral-500">確定済みの月はまだありません。</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {months.map((m) => (
              <li key={m.snapshot_month}>
                <Link
                  href={`/closing?month=${m.snapshot_month}`}
                  className="text-blue-600 underline dark:text-blue-400"
                >
                  {m.snapshot_month}
                </Link>
                <span className="ml-2 text-neutral-500">
                  {m.row_count}行 ／ 確定：{m.finalized_by}（{m.finalized_at}）
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <section className="space-y-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-lg font-bold">
              {selected} 月末在庫一覧表（基準日：{lastDayOfMonth(selected)}）
            </h2>
            {meta && (
              <span className="text-xs text-neutral-500 print:hidden">
                確定：{meta.finalized_by}（{meta.finalized_at}）／ 印刷は Ctrl+P（一覧表のみが出力されます）
              </span>
            )}
          </div>
          {snapshot.length === 0 ? (
            <p className="text-sm text-neutral-500">{selected} の確定データはありません。</p>
          ) : (
            <SnapshotTable rows={snapshot} month={selected} />
          )}

          {overrides.length > 0 && (
            <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm print:hidden dark:border-amber-700 dark:bg-amber-950">
              <h3 className="font-bold">表示値の修正履歴（社内用・印刷には出ません）</h3>
              <ul className="space-y-1">
                {overrides.map((o) => (
                  <li key={o.id}>
                    {o.item_name} {o.spec || ""}（{o.warehouse_code}
                    {o.production_date ? `・${o.production_date}` : ""}
                    {o.lot_no ? `・${o.lot_no}` : ""}）：原本 {o.original_quantity} →{" "}
                    <strong>{o.override_quantity}</strong>
                    ／理由：{o.reason}／{o.operator}（{o.created_at}）
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
