import { Fragment } from "react";
import { listStock, type StockListRow } from "@/lib/data";
import { adjustStockAction } from "./actions";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ saved?: string; error?: string }> };

export default async function StockPage({ searchParams }: Props) {
  const { saved, error } = await searchParams;
  const rows = await listStock();

  // 荷主でグループ化（企画書 6.6 在庫報告の並び）
  const byShipper = new Map<string, StockListRow[]>();
  for (const r of rows) {
    const list = byShipper.get(r.shipper_name) ?? [];
    list.push(r);
    byShipper.set(r.shipper_name, list);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">在庫一覧</h1>
      {saved && (
        <p className="rounded bg-green-50 p-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          {saved}
        </p>
      )}
      {error && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {byShipper.size === 0 && (
        <p className="text-sm text-neutral-500">在庫はありません。</p>
      )}
      {[...byShipper.entries()].map(([shipperName, stocks]) => (
        <section key={shipperName} className="space-y-2">
          <h2 className="border-b pb-1 font-bold">{shipperName}</h2>
          <div className="overflow-x-auto">
            {/* table-fixed + 共通の列幅%で、荷主グループ間でも列の縦ラインを揃える */}
            <table className="w-full min-w-[780px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[8%]" />
                <col className="w-[19%]" />
                <col className="w-[11%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[11%]" />
                <col className="w-[9%]" />
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
                  <th className="py-1 pr-3 font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => (
                  <Fragment key={s.stock_id}>
                    <tr className="border-b border-neutral-100 dark:border-neutral-900">
                      <td className="break-words py-1 pr-3">{s.item_name}</td>
                      <td className="break-words py-1 pr-3">{s.spec || "―"}</td>
                      <td className="break-words py-1 pr-3">
                        {s.warehouse_code} {s.warehouse_name}
                      </td>
                      <td className="py-1 pr-3">{s.production_date ?? "―"}</td>
                      <td className="break-words py-1 pr-3 font-mono">{s.lot_no || "―"}</td>
                      <td className="break-words py-1 pr-3 font-mono">{s.order_no || "―"}</td>
                      <td
                        className={`py-1 pr-3 text-right font-mono ${Number(s.quantity) < 0 ? "font-bold text-red-600" : ""}`}
                      >
                        {s.quantity}
                        {Number(s.quantity) < 0 && (
                          <span className="block text-xs">（マイナス在庫）</span>
                        )}
                      </td>
                      <td className="py-1 pr-3" />
                    </tr>
                    <tr>
                      <td colSpan={8} className="pb-2">
                        <details>
                          <summary className="cursor-pointer text-xs text-blue-600 hover:underline dark:text-blue-400">
                            数量を手修正する
                          </summary>
                          <form
                            action={adjustStockAction}
                            className="mt-2 flex flex-wrap items-end gap-2 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800"
                          >
                            <input type="hidden" name="stockId" value={s.stock_id} />
                            <input type="hidden" name="stockVersion" value={s.version} />
                            <label>
                              新しい数量
                              <input
                                type="number"
                                step="0.001"
                                name="newQuantity"
                                defaultValue={s.quantity}
                                required
                                className="ml-1 w-28 rounded border px-1 py-0.5 dark:bg-neutral-900"
                              />
                            </label>
                            <label className="flex-1">
                              修正理由（必須）
                              <input
                                name="reason"
                                required
                                placeholder="例：棚卸で実数と差異。現物 55 を確認"
                                className="ml-1 w-2/3 rounded border px-1 py-0.5 dark:bg-neutral-900"
                              />
                            </label>
                            <button
                              type="submit"
                              className="rounded border px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              手修正を記録
                            </button>
                          </form>
                        </details>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
