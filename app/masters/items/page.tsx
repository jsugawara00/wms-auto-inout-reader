import { Fragment } from "react";
import { listItems, listShipperMasters, type ItemListRow } from "@/lib/masters";
import { currentRole } from "@/lib/auth";
import { createItemAction, updateItemAction, mergeItemsAction } from "./actions";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ saved?: string; error?: string; edit?: string }> };

export default async function ItemMasterPage({ searchParams }: Props) {
  const { saved, error, edit } = await searchParams;
  const [items, shippers, role] = await Promise.all([
    listItems(),
    listShipperMasters(),
    currentRole(),
  ]);
  const isAdmin = role === "admin";
  const editId = edit ? Number(edit) : null;
  const editing = editId ? items.find((i) => i.id === editId) : undefined;

  // 荷主でグループ化（統合の相手候補は同一荷主内に限る）
  const byShipper = new Map<string, ItemListRow[]>();
  for (const it of items) {
    const list = byShipper.get(it.shipper_name) ?? [];
    list.push(it);
    byShipper.set(it.shipper_name, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">商品マスタ</h1>
        <span className="space-x-3 text-sm">
          <a href="/masters/shippers" className="text-blue-600 underline dark:text-blue-400">荷主マスタへ</a>
          <a href="/masters/warehouses" className="text-blue-600 underline dark:text-blue-400">倉庫マスタへ</a>
          <a href="/masters/tariffs" className="text-blue-600 underline dark:text-blue-400">タリフへ</a>
        </span>
      </div>

      {saved && (
        <p className="rounded bg-green-50 p-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">{saved}</p>
      )}
      {error && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}
      {!isAdmin && (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          閲覧のみ（登録・編集・統合には管理者権限が必要です）。
        </p>
      )}

      {[...byShipper.entries()].map(([shipperName, list]) => (
        <section key={shipperName} className="space-y-2">
          <h2 className="border-b pb-1 font-bold">{shipperName}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[28%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[22%]" />
              </colgroup>
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="py-1 pr-3 font-normal">品名</th>
                  <th className="py-1 pr-3 font-normal">規格</th>
                  <th className="py-1 pr-3 font-normal">商品コード</th>
                  <th className="py-1 pr-3 text-right font-normal">単価</th>
                  <th className="py-1 pr-3 text-right font-normal">在庫行</th>
                  <th className="py-1 pr-3 font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {list.map((it) => (
                  <Fragment key={it.id}>
                    <tr className="border-b border-neutral-100 align-top dark:border-neutral-900">
                      <td className="break-words py-1 pr-3">{it.name}</td>
                      <td className="break-words py-1 pr-3">{it.spec || "―"}</td>
                      <td className="break-words py-1 pr-3 font-mono text-xs">{it.item_code || "―"}</td>
                      <td className="py-1 pr-3 text-right font-mono">{it.unit_price ?? "―"}</td>
                      <td className="py-1 pr-3 text-right">{it.stock_count}</td>
                      <td className="py-1 pr-3">
                        {isAdmin && (
                          <a href={`/masters/items?edit=${it.id}`} className="text-blue-600 underline dark:text-blue-400">
                            編集
                          </a>
                        )}
                      </td>
                    </tr>
                    {isAdmin && list.length > 1 && (
                      <tr>
                        <td colSpan={6} className="pb-2">
                          <details>
                            <summary className="cursor-pointer text-xs text-blue-600 hover:underline dark:text-blue-400">
                              この品目を別品目へ統合（マージ）
                            </summary>
                            <form
                              action={mergeItemsAction}
                              className="mt-2 flex flex-wrap items-end gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-700 dark:bg-amber-950"
                            >
                              <input type="hidden" name="sourceItemId" value={it.id} />
                              <span className="text-xs text-neutral-600 dark:text-neutral-400">
                                「{it.name} {it.spec || "規格なし"}」を統合先へ寄せます（在庫・履歴は統合先へ移り、この品目は削除されます）。
                              </span>
                              <label>
                                統合先
                                <select
                                  name="targetItemId"
                                  required
                                  defaultValue=""
                                  className="ml-1 rounded border px-1 py-0.5 dark:bg-neutral-900"
                                >
                                  <option value="" disabled>
                                    選択してください
                                  </option>
                                  {list
                                    .filter((o) => o.id !== it.id)
                                    .map((o) => (
                                      <option key={o.id} value={o.id}>
                                        {o.name} {o.spec || "規格なし"}
                                      </option>
                                    ))}
                                </select>
                              </label>
                              <button
                                type="submit"
                                className="rounded border border-amber-500 px-3 py-1 font-bold text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
                              >
                                統合する
                              </button>
                            </form>
                          </details>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {items.length === 0 && <p className="text-sm text-neutral-500">品目はまだありません。</p>}

      {isAdmin && editing && (
        <section className="space-y-3 rounded border border-blue-300 p-4 text-sm dark:border-blue-800">
          <h2 className="font-bold">品目を編集：{editing.shipper_name} / {editing.name}</h2>
          <form action={updateItemAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="itemId" value={editing.id} />
            <label>
              品名
              <input name="name" defaultValue={editing.name} required className="ml-1 w-48 rounded border px-2 py-1 dark:bg-neutral-900" />
            </label>
            <label>
              規格
              <input name="spec" defaultValue={editing.spec} className="ml-1 w-28 rounded border px-2 py-1 dark:bg-neutral-900" />
            </label>
            <label>
              商品コード
              <input name="itemCode" defaultValue={editing.item_code} className="ml-1 w-36 rounded border px-2 py-1 font-mono dark:bg-neutral-900" />
            </label>
            <label>
              単価
              <input type="number" step="0.01" name="unitPrice" defaultValue={editing.unit_price ?? ""} className="ml-1 w-28 rounded border px-2 py-1 dark:bg-neutral-900" />
            </label>
            <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700">
              更新
            </button>
            <a href="/masters/items" className="rounded border px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              キャンセル
            </a>
          </form>
        </section>
      )}

      {isAdmin && !editing && (
        <section className="space-y-3 rounded border border-neutral-300 p-4 text-sm dark:border-neutral-700">
          <h2 className="font-bold">品目を新規登録</h2>
          <form action={createItemAction} className="flex flex-wrap items-end gap-3">
            <label>
              荷主
              <select name="shipperId" required defaultValue="" className="ml-1 rounded border px-2 py-1 dark:bg-neutral-900">
                <option value="" disabled>
                  選択
                </option>
                {shippers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              品名
              <input name="name" required className="ml-1 w-48 rounded border px-2 py-1 dark:bg-neutral-900" />
            </label>
            <label>
              規格
              <input name="spec" className="ml-1 w-28 rounded border px-2 py-1 dark:bg-neutral-900" />
            </label>
            <label>
              商品コード
              <input name="itemCode" className="ml-1 w-36 rounded border px-2 py-1 font-mono dark:bg-neutral-900" />
            </label>
            <label>
              単価
              <input type="number" step="0.01" name="unitPrice" className="ml-1 w-28 rounded border px-2 py-1 dark:bg-neutral-900" />
            </label>
            <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700">
              登録
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
