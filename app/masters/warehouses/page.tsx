import { listWarehouseMasters } from "@/lib/masters";
import { currentRole } from "@/lib/auth";
import { createWarehouseAction, updateWarehouseAction } from "./actions";

export const dynamic = "force-dynamic";

const TYPE_LABEL = { normal: "常温", chilled: "冷蔵", frozen: "冷凍" } as const;

type Props = { searchParams: Promise<{ saved?: string; error?: string; edit?: string }> };

export default async function WarehouseMasterPage({ searchParams }: Props) {
  const { saved, error, edit } = await searchParams;
  const [warehouses, role] = await Promise.all([listWarehouseMasters(), currentRole()]);
  const isAdmin = role === "admin";
  const editId = edit ? Number(edit) : null;
  const editing = editId ? warehouses.find((w) => w.id === editId) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">倉庫マスタ</h1>
        <span className="space-x-3 text-sm">
          <a href="/masters/shippers" className="text-blue-600 underline dark:text-blue-400">荷主マスタへ</a>
          <a href="/masters/items" className="text-blue-600 underline dark:text-blue-400">商品マスタへ</a>
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
          閲覧のみ（登録・編集には管理者権限が必要です）。
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[40%]" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2 pr-3 font-normal">コード</th>
              <th className="py-2 pr-3 font-normal">倉庫名</th>
              <th className="py-2 pr-3 font-normal">種類</th>
              <th className="py-2 pr-3 text-right font-normal">在庫行</th>
              <th className="py-2 pr-3 font-normal">操作</th>
            </tr>
          </thead>
          <tbody>
            {warehouses.map((w) => (
              <tr key={w.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-2 pr-3 font-mono font-bold">{w.code}</td>
                <td className="break-words py-2 pr-3">{w.name}</td>
                <td className="py-2 pr-3">{TYPE_LABEL[w.warehouse_type]}</td>
                <td className="py-2 pr-3 text-right">{w.stock_count}</td>
                <td className="py-2 pr-3">
                  {isAdmin && (
                    <a href={`/masters/warehouses?edit=${w.id}`} className="text-blue-600 underline dark:text-blue-400">
                      編集
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && editing && (
        <section className="space-y-3 rounded border border-blue-300 p-4 text-sm dark:border-blue-800">
          <h2 className="font-bold">倉庫を編集：{editing.code} {editing.name}</h2>
          <form action={updateWarehouseAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="warehouseId" value={editing.id} />
            <label>
              コード
              <input name="code" defaultValue={editing.code} required className="ml-1 w-24 rounded border px-2 py-1 font-mono dark:bg-neutral-900" />
            </label>
            <label>
              倉庫名
              <input name="name" defaultValue={editing.name} required className="ml-1 w-56 rounded border px-2 py-1 dark:bg-neutral-900" />
            </label>
            <label>
              種類
              <select name="warehouseType" defaultValue={editing.warehouse_type} className="ml-1 rounded border px-2 py-1 dark:bg-neutral-900">
                <option value="normal">常温</option>
                <option value="chilled">冷蔵</option>
                <option value="frozen">冷凍</option>
              </select>
            </label>
            <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700">
              更新
            </button>
            <a href="/masters/warehouses" className="rounded border px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              キャンセル
            </a>
          </form>
        </section>
      )}

      {isAdmin && !editing && (
        <section className="space-y-3 rounded border border-neutral-300 p-4 text-sm dark:border-neutral-700">
          <h2 className="font-bold">倉庫を新規登録</h2>
          <form action={createWarehouseAction} className="flex flex-wrap items-end gap-3">
            <label>
              コード
              <input name="code" required placeholder="例: W4" className="ml-1 w-24 rounded border px-2 py-1 font-mono dark:bg-neutral-900" />
            </label>
            <label>
              倉庫名
              <input name="name" required placeholder="例: 第四倉庫（定温）" className="ml-1 w-56 rounded border px-2 py-1 dark:bg-neutral-900" />
            </label>
            <label>
              種類
              <select name="warehouseType" defaultValue="normal" className="ml-1 rounded border px-2 py-1 dark:bg-neutral-900">
                <option value="normal">常温</option>
                <option value="chilled">冷蔵</option>
                <option value="frozen">冷凍</option>
              </select>
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
