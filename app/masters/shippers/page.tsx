import { listShipperMasters } from "@/lib/masters";
import { currentRole } from "@/lib/auth";
import { createShipperAction, updateShipperAction } from "./actions";
import type { ShipperListRow } from "@/lib/masters";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ saved?: string; error?: string; edit?: string }> };

function ShipperFields({ s }: { s?: ShipperListRow }) {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <label>
          正式名称
          <input
            name="name"
            defaultValue={s?.name ?? ""}
            required
            className="ml-1 w-56 rounded border px-2 py-1 dark:bg-neutral-900"
          />
        </label>
        <label>
          セクション（任意）
          <input
            name="section"
            defaultValue={s?.section ?? ""}
            className="ml-1 w-32 rounded border px-2 py-1 dark:bg-neutral-900"
          />
        </label>
      </div>
      <label className="block">
        別名（改行またはカンマ区切り。表記ゆれ照合に使用）
        <textarea
          name="aliases"
          rows={2}
          defaultValue={(s?.aliases ?? []).join("\n")}
          placeholder={"例：\nマルノウ食品(株)\n(株)マルノウ食品"}
          className="mt-1 w-full rounded border px-2 py-1 text-xs dark:bg-neutral-900"
        />
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <label>
          引き当てルール
          <select
            name="allocationRule"
            defaultValue={s?.allocation_rule ?? "fifo"}
            className="ml-1 rounded border px-2 py-1 dark:bg-neutral-900"
          >
            <option value="fifo">FIFO（古い製造日から）</option>
            <option value="lot_specified">荷主指定ロット</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            name="productionDateManaged"
            defaultChecked={s ? s.production_date_managed : true}
          />
          製造日管理あり
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label>
          電話（任意）
          <input name="phone" defaultValue={s?.phone ?? ""} className="ml-1 w-40 rounded border px-2 py-1 dark:bg-neutral-900" />
        </label>
        <label>
          FAX（任意）
          <input name="fax" defaultValue={s?.fax ?? ""} className="ml-1 w-40 rounded border px-2 py-1 dark:bg-neutral-900" />
        </label>
        <label>
          メール（任意）
          <input name="email" defaultValue={s?.email ?? ""} className="ml-1 w-56 rounded border px-2 py-1 dark:bg-neutral-900" />
        </label>
      </div>
      <label className="block">
        特殊例外（自由記述・任意）
        <textarea
          name="exceptionsNote"
          rows={2}
          defaultValue={s?.exceptions_note ?? ""}
          placeholder="例：賞味期限残り90日を切ったロットは出庫前に荷主へ電話確認（自動適用せず、確認フォームに表示するのみ）"
          className="mt-1 w-full rounded border px-2 py-1 text-xs dark:bg-neutral-900"
        />
      </label>
    </>
  );
}

export default async function ShipperMasterPage({ searchParams }: Props) {
  const { saved, error, edit } = await searchParams;
  const [shippers, role] = await Promise.all([listShipperMasters(), currentRole()]);
  const isAdmin = role === "admin";
  const editId = edit ? Number(edit) : null;
  const editing = editId ? shippers.find((s) => s.id === editId) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">荷主マスタ</h1>
        <a href="/masters/items" className="text-sm text-blue-600 underline dark:text-blue-400">
          商品マスタへ →
        </a>
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
        <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[16%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2 pr-3 font-normal">荷主名</th>
              <th className="py-2 pr-3 font-normal">別名</th>
              <th className="py-2 pr-3 font-normal">引き当て</th>
              <th className="py-2 pr-3 font-normal">製造日管理</th>
              <th className="py-2 pr-3 font-normal">品目数</th>
              <th className="py-2 pr-3 font-normal">連絡先</th>
              <th className="py-2 pr-3 font-normal">操作</th>
            </tr>
          </thead>
          <tbody>
            {shippers.map((s) => (
              <tr key={s.id} className="border-b border-neutral-100 align-top dark:border-neutral-900">
                <td className="break-words py-2 pr-3 font-bold">{s.name}</td>
                <td className="break-words py-2 pr-3 text-xs text-neutral-500">
                  {(s.aliases ?? []).join("、") || "―"}
                </td>
                <td className="py-2 pr-3">{s.allocation_rule === "fifo" ? "FIFO" : "指定ロット"}</td>
                <td className="py-2 pr-3">{s.production_date_managed ? "あり" : "なし"}</td>
                <td className="py-2 pr-3">{s.item_count}</td>
                <td className="break-words py-2 pr-3 text-xs">{s.phone || s.email || "―"}</td>
                <td className="py-2 pr-3">
                  {isAdmin && (
                    <a href={`/masters/shippers?edit=${s.id}`} className="text-blue-600 underline dark:text-blue-400">
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
          <h2 className="font-bold">荷主を編集：{editing.name}</h2>
          <form action={updateShipperAction} className="space-y-3">
            <input type="hidden" name="shipperId" value={editing.id} />
            <ShipperFields s={editing} />
            <div className="flex gap-2">
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700">
                更新
              </button>
              <a href="/masters/shippers" className="rounded border px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                キャンセル
              </a>
            </div>
          </form>
        </section>
      )}

      {isAdmin && !editing && (
        <section className="space-y-3 rounded border border-neutral-300 p-4 text-sm dark:border-neutral-700">
          <h2 className="font-bold">荷主を新規登録</h2>
          <form action={createShipperAction} className="space-y-3">
            <ShipperFields />
            <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700">
              登録
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
