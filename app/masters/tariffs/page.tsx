import { listTariffs, type TariffRow } from "@/lib/billing";
import { listShippers, listItemsByShipper } from "@/lib/data";
import { currentRole } from "@/lib/auth";
import { saveTariffAction } from "./actions";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ saved?: string; error?: string; shipper?: string; edit?: string }>;
};

export default async function TariffMasterPage({ searchParams }: Props) {
  const { saved, error, shipper, edit } = await searchParams;
  const [tariffs, shippers, role] = await Promise.all([
    listTariffs(),
    listShippers(),
    currentRole(),
  ]);
  const isAdmin = role === "admin";

  const selectedShipperId = shipper ? Number(shipper) : null;
  const selectedShipper = selectedShipperId
    ? shippers.find((s) => s.id === selectedShipperId)
    : undefined;
  const items = selectedShipper ? await listItemsByShipper(selectedShipper.id) : [];
  const editId = edit ? Number(edit) : null;
  const editing = editId ? tariffs.find((t) => t.id === editId) : undefined;
  // 編集対象があればその荷主を選択扱いにする
  const formShipperId = editing ? editing.shipper_id : selectedShipperId;
  const formShipper = editing
    ? shippers.find((s) => s.id === editing.shipper_id)
    : selectedShipper;
  const formItems = editing
    ? await listItemsByShipper(editing.shipper_id)
    : items;

  // 荷主でグループ化
  const byShipper = new Map<number, { name: string; rows: TariffRow[] }>();
  for (const s of shippers) byShipper.set(s.id, { name: s.name, rows: [] });
  for (const t of tariffs) {
    const g = byShipper.get(t.shipper_id);
    if (g) g.rows.push(t);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">タリフ（料率表）</h1>
        <span className="space-x-3 text-sm">
          <a href="/masters/shippers" className="text-blue-600 underline dark:text-blue-400">荷主マスタへ</a>
          <a href="/masters/items" className="text-blue-600 underline dark:text-blue-400">商品マスタへ</a>
          <a href="/billing" className="text-blue-600 underline dark:text-blue-400">請求へ</a>
        </span>
      </div>

      {saved && (
        <p className="rounded bg-green-50 p-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">{saved}</p>
      )}
      {error && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}
      <p className="rounded bg-neutral-50 p-2 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
        単価の適用は <strong>品目のタリフ → 荷主既定</strong> の順です。保管料は三期制
        （1期=1〜10日・2期=11〜20日・3期=21〜月末、課金数量=期首在庫+期中入庫）の期ごとに適用されます。
        金額はすべて税抜です。
      </p>
      {!isAdmin && (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          閲覧のみ（登録・編集には管理者権限が必要です）。
        </p>
      )}

      {[...byShipper.entries()].map(([sid, g]) => (
        <section key={sid} className="space-y-2">
          <h2 className="border-b pb-1 font-bold">{g.name}</h2>
          {g.rows.length === 0 ? (
            <p className="text-sm text-neutral-500">タリフ未設定。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[17%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th className="py-1 pr-3 font-normal">対象</th>
                    <th className="py-1 pr-3 text-right font-normal">保管料(円/期)</th>
                    <th className="py-1 pr-3 text-right font-normal">入庫荷役(円/個)</th>
                    <th className="py-1 pr-3 text-right font-normal">出庫荷役(円/個)</th>
                    <th className="py-1 pr-3 font-normal">メモ</th>
                    <th className="py-1 pr-3 font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((t) => (
                    <tr key={t.id} className="border-b border-neutral-100 align-top dark:border-neutral-900">
                      <td className="break-words py-1 pr-3">
                        {t.item_id === null ? (
                          <span className="font-bold">（荷主既定）</span>
                        ) : (
                          `${t.item_name} ${t.item_spec || "規格なし"}`
                        )}
                      </td>
                      <td className="py-1 pr-3 text-right font-mono">{Number(t.storage_rate)}</td>
                      <td className="py-1 pr-3 text-right font-mono">{Number(t.handling_in_rate)}</td>
                      <td className="py-1 pr-3 text-right font-mono">{Number(t.handling_out_rate)}</td>
                      <td className="break-words py-1 pr-3 text-xs text-neutral-500">{t.note || "―"}</td>
                      <td className="py-1 pr-3">
                        {isAdmin && (
                          <a href={`/masters/tariffs?edit=${t.id}`} className="text-blue-600 underline dark:text-blue-400">
                            編集
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      {isAdmin && (
        <section className="space-y-3 rounded border border-neutral-300 p-4 text-sm dark:border-neutral-700">
          <h2 className="font-bold">{editing ? "タリフを編集" : "タリフを登録・更新"}</h2>

          {/* 荷主の選択（GETで再読み込み。品目一覧を絞る） */}
          {!editing && (
            <form method="get" className="flex flex-wrap items-end gap-2">
              <label>
                荷主
                <select
                  name="shipper"
                  defaultValue={selectedShipperId ?? ""}
                  className="ml-1 rounded border px-2 py-1 dark:bg-neutral-900"
                >
                  <option value="" disabled>選択</option>
                  {shippers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="rounded border px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                この荷主で入力
              </button>
            </form>
          )}

          {formShipper ? (
            <form action={saveTariffAction} className="space-y-3">
              <input type="hidden" name="shipperId" value={formShipper.id} />
              <div className="text-xs text-neutral-500">荷主：<strong>{formShipper.name}</strong></div>
              <div className="flex flex-wrap items-end gap-3">
                <label>
                  対象
                  <select
                    name="target"
                    required
                    defaultValue={editing ? (editing.item_id === null ? "default" : String(editing.item_id)) : "default"}
                    className="ml-1 rounded border px-2 py-1 dark:bg-neutral-900"
                  >
                    <option value="default">（荷主既定）</option>
                    {formItems.map((it) => (
                      <option key={it.id} value={it.id}>{it.name} {it.spec || "規格なし"}</option>
                    ))}
                  </select>
                </label>
                <label>
                  保管料(円/期)
                  <input type="number" step="0.0001" name="storageRate" defaultValue={editing ? Number(editing.storage_rate) : 0} className="ml-1 w-28 rounded border px-2 py-1 dark:bg-neutral-900" />
                </label>
                <label>
                  入庫荷役(円/個)
                  <input type="number" step="0.0001" name="handlingInRate" defaultValue={editing ? Number(editing.handling_in_rate) : 0} className="ml-1 w-28 rounded border px-2 py-1 dark:bg-neutral-900" />
                </label>
                <label>
                  出庫荷役(円/個)
                  <input type="number" step="0.0001" name="handlingOutRate" defaultValue={editing ? Number(editing.handling_out_rate) : 0} className="ml-1 w-28 rounded border px-2 py-1 dark:bg-neutral-900" />
                </label>
              </div>
              <label className="block">
                メモ（契約条件など・任意。表示のみで自動適用しません）
                <input name="note" defaultValue={editing?.note ?? ""} className="ml-1 w-2/3 rounded border px-2 py-1 dark:bg-neutral-900" />
              </label>
              <p className="text-xs text-neutral-500">
                同じ荷主×対象のタリフが既にある場合は更新になります。
              </p>
              <div className="flex gap-2">
                <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700">
                  保存
                </button>
                {editing && (
                  <a href="/masters/tariffs" className="rounded border px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    キャンセル
                  </a>
                )}
              </div>
            </form>
          ) : (
            <p className="text-sm text-neutral-500">上で荷主を選ぶと入力欄が表示されます。</p>
          )}
        </section>
      )}
    </div>
  );
}
