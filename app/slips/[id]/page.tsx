import { notFound } from "next/navigation";
import {
  getSlipDetail,
  listWarehouses,
  listItemsByShipper,
  listShippers,
  getSlipHistory,
} from "@/lib/data";
import { currentOperator, currentRole } from "@/lib/auth";
import {
  saveLineAction,
  holdSlipAction,
  releaseSlipAction,
  resolveLineAction,
  assignShipperAction,
  requestShipperRegistrationAction,
} from "../actions";
import { ConfirmBox } from "./confirm-box";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  unprocessed: "未処理",
  confirmed: "確認済",
  done: "完了",
  hold: "保留",
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export default async function SlipDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { saved, error } = await searchParams;
  const slipId = Number(id);
  if (!Number.isInteger(slipId)) notFound();

  const detail = await getSlipDetail(slipId);
  if (!detail) notFound();
  const { slip, shipper, lines } = detail;

  const [warehouses, operator, role, shipperItems, history, allShippers] =
    await Promise.all([
      listWarehouses(),
      currentOperator(),
      currentRole(),
      shipper ? listItemsByShipper(shipper.id) : Promise.resolve([]),
      getSlipHistory(slipId),
      shipper ? Promise.resolve([]) : listShippers(),
    ]);
  const isAdmin = role === "admin";
  const editable = slip.status === "unprocessed";

  // 読取された荷主名（荷主確定フォームのプレフィル用）
  const extracted =
    typeof slip.extracted_json === "string"
      ? (JSON.parse(slip.extracted_json) as { shipper_name?: string })
      : (slip.extracted_json as { shipper_name?: string } | null);
  const rawShipperName = extracted?.shipper_name ?? "";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">
        伝票 #{slip.id}（{slip.slip_type === "inbound" ? "入庫" : "出庫"}・
        {STATUS_LABEL[slip.status]}）
      </h1>

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

      <section className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
        <div>荷主：{shipper?.name ?? "（未確定）"}</div>
        <div>伝票番号：<span className="font-mono">{slip.slip_number || "―"}</span></div>
        <div>依頼形式：{slip.source_type === "fax" ? "FAX" : "メール"}</div>
        <div>取込日時：{slip.received_at}</div>
        <div>依頼日時：{slip.requested_at ?? "―"}</div>
        <div>
          読取確信度：
          {slip.confidence === "low" ? (
            <span className="text-red-600">低（要確認）</span>
          ) : (
            (slip.confidence ?? "―")
          )}
        </div>
        {slip.note && <div className="col-span-2">読取メモ：{slip.note}</div>}
        {slip.status === "hold" && (
          <div className="col-span-2 text-red-600">保留理由：{slip.hold_reason}</div>
        )}
        {slip.status === "done" && (
          <div className="col-span-2">
            確定：{slip.confirmed_by}（{slip.confirmed_at}）
          </div>
        )}
      </section>

      {editable && !shipper && isAdmin && (
        <section className="space-y-2 rounded border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          <h2 className="font-bold text-red-700 dark:text-red-300">荷主の確定が必要です</h2>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            読取された荷主名：<strong>{rawShipperName || "（読取なし）"}</strong>。
            既存の荷主に紐付けるか、新規荷主として登録してください。確定すると品目の照合を自動で再実行します。
          </p>
          <form action={assignShipperAction} className="space-y-3">
            <input type="hidden" name="slipId" value={slip.id} />
            <input type="hidden" name="slipVersion" value={slip.version} />
            <input type="hidden" name="rawShipperName" value={rawShipperName} />
            <label className="block">
              判断
              <select
                name="choice"
                required
                defaultValue=""
                className="ml-2 rounded border px-2 py-1 dark:bg-neutral-900"
              >
                <option value="" disabled>
                  選択してください
                </option>
                {allShippers.map((s) => (
                  <option key={s.id} value={s.id}>
                    既存：{s.name}
                  </option>
                ))}
                <option value="new">新規荷主として登録</option>
              </select>
            </label>
            <fieldset className="space-y-2 rounded border border-neutral-300 p-3 dark:border-neutral-700">
              <legend className="px-1 text-xs text-neutral-500">
                新規登録の場合のみ入力（荷主マスタに登録されます）
              </legend>
              <div className="flex flex-wrap gap-3">
                <label>
                  正式名称
                  <input
                    name="officialName"
                    defaultValue={rawShipperName}
                    className="ml-1 w-56 rounded border px-2 py-1 dark:bg-neutral-900"
                  />
                </label>
                <label>
                  セクション（任意）
                  <input
                    name="section"
                    className="ml-1 w-32 rounded border px-2 py-1 dark:bg-neutral-900"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label>
                  引き当てルール
                  <select
                    name="allocationRule"
                    defaultValue="fifo"
                    className="ml-1 rounded border px-2 py-1 dark:bg-neutral-900"
                  >
                    <option value="fifo">FIFO（古い製造日から）</option>
                    <option value="lot_specified">荷主指定ロット</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" name="productionDateManaged" defaultChecked />
                  製造日管理あり（食品系は推奨）
                </label>
              </div>
              <label className="block">
                特殊例外（自由記述・任意）
                <textarea
                  name="exceptionsNote"
                  rows={2}
                  placeholder="例：賞味期限残り90日を切ったロットは出庫前に荷主へ電話確認（自動適用しません。確認フォームに表示するのみ）"
                  className="mt-1 w-full rounded border px-2 py-1 text-xs dark:bg-neutral-900"
                />
              </label>
            </fieldset>
            <button
              type="submit"
              className="rounded border border-red-400 px-4 py-2 font-bold text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900"
            >
              この内容で荷主を確定
            </button>
          </form>
        </section>
      )}

      {editable && !shipper && !isAdmin && (
        <section className="space-y-2 rounded border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          <h2 className="font-bold text-red-700 dark:text-red-300">荷主が未確定です</h2>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            読取された荷主名：<strong>{rawShipperName || "（読取なし）"}</strong>。
            マスタ登録の権限がないため、管理者へ登録を依頼してください。登録され次第、品目照合が自動で再実行されます。
          </p>
          <form action={requestShipperRegistrationAction}>
            <input type="hidden" name="slipId" value={slip.id} />
            <input type="hidden" name="rawShipperName" value={rawShipperName} />
            <button
              type="submit"
              className="rounded border border-red-400 px-4 py-2 font-bold text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900"
            >
              管理者へマスタ登録を依頼
            </button>
          </form>
        </section>
      )}

      {shipper && (
        <section className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
          <h2 className="font-bold">荷主ルール（荷主マスタ）</h2>
          <p>
            引き当て：{shipper.allocation_rule === "fifo" ? "FIFO（古い製造日から）" : "荷主指定ロット"}
            ／ 製造日管理：{shipper.production_date_managed ? "あり" : "なし"}
          </p>
          {shipper.exceptions_note && (
            <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-neutral-700 dark:text-neutral-300">
              {shipper.exceptions_note}
            </pre>
          )}
          <p className="mt-1 text-xs text-neutral-500">
            ※特殊例外は自動適用しません。内容を読んで担当が判断してください。
          </p>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="font-bold">明細（{lines.length}行）</h2>
        {lines.map((line) => (
          <div
            key={line.id}
            className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800"
          >
          <form action={saveLineAction}>
            <input type="hidden" name="slipId" value={slip.id} />
            <input type="hidden" name="lineId" value={line.id} />
            <input type="hidden" name="slipVersion" value={slip.version} />
            <div className="mb-2 flex items-baseline gap-3">
              <span className="font-bold">行{line.line_no}</span>
              <span>
                {line.item_name ?? `（未照合）${line.item_name_raw}`}
                {(line.item_spec ?? line.spec_raw) && ` / ${line.item_spec ?? line.spec_raw}`}
              </span>
              {line.line_status === "hold" && (
                <span className="text-red-600">保留：{line.hold_reason}</span>
              )}
              <span className="ml-auto text-xs text-neutral-400">
                読取原文：{line.item_name_raw} {line.spec_raw}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <label>
                倉庫
                <select
                  name="warehouseId"
                  defaultValue={line.warehouse_id ?? ""}
                  disabled={!editable}
                  className="ml-1 rounded border px-1 py-0.5 dark:bg-neutral-900"
                >
                  <option value="">―</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                製造日
                <input
                  type="date"
                  name="productionDate"
                  defaultValue={line.production_date ?? ""}
                  disabled={!editable}
                  className="ml-1 rounded border px-1 py-0.5 dark:bg-neutral-900"
                />
              </label>
              <label>
                ロット
                <input
                  name="lotNo"
                  defaultValue={line.lot_no}
                  disabled={!editable}
                  className="ml-1 w-24 rounded border px-1 py-0.5 dark:bg-neutral-900"
                />
              </label>
              <label>
                特定番号
                <input
                  name="orderNo"
                  defaultValue={line.order_no}
                  disabled={!editable}
                  className="ml-1 w-28 rounded border px-1 py-0.5 dark:bg-neutral-900"
                />
              </label>
              <label>
                数量
                <input
                  type="number"
                  step="0.001"
                  name="quantity"
                  defaultValue={line.quantity}
                  disabled={!editable}
                  className="ml-1 w-24 rounded border px-1 py-0.5 dark:bg-neutral-900"
                />
              </label>
              <label>
                現場報告値
                <input
                  type="number"
                  step="0.001"
                  name="siteReportedQuantity"
                  defaultValue={line.site_reported_quantity ?? ""}
                  disabled={!editable}
                  className="ml-1 w-24 rounded border px-1 py-0.5 dark:bg-neutral-900"
                />
              </label>
              {line.site_reported_quantity !== null &&
                Number(line.site_reported_quantity) !== Number(line.quantity) && (
                  <span className="col-span-2 self-center font-bold text-red-600">
                    ⚠ 依頼値と現場報告値が食い違っています
                  </span>
                )}
            </div>
            {editable && (
              <div className="mt-2 flex items-end gap-2">
                <label className="flex-1">
                  修正理由（必須）
                  <input
                    name="reason"
                    placeholder="例：FAX原本を再確認し数量を訂正"
                    className="ml-1 w-2/3 rounded border px-1 py-0.5 dark:bg-neutral-900"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded border px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  この行を修正
                </button>
              </div>
            )}
          </form>

          {editable && line.line_status === "hold" && shipper && (
            <form
              action={resolveLineAction}
              className="mt-3 space-y-2 rounded border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950"
            >
              <input type="hidden" name="slipId" value={slip.id} />
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="slipVersion" value={slip.version} />
              <h3 className="font-bold text-red-700 dark:text-red-300">保留の解消</h3>
              <p className="text-xs text-neutral-600 dark:text-neutral-400">
                読取「{line.item_name_raw} {line.spec_raw || "規格なし"}」は既存の品目ですか、新規品目ですか？
                現物・荷主に確認のうえ選択してください。
                {!isAdmin && "（新規品目の登録には管理者権限が必要です）"}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label>
                  判断
                  <select
                    name="choice"
                    required
                    defaultValue=""
                    className="ml-1 rounded border px-1 py-0.5 dark:bg-neutral-900"
                  >
                    <option value="" disabled>
                      選択してください
                    </option>
                    {shipperItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        既存：{it.name} {it.spec || "規格なし"}
                      </option>
                    ))}
                    {isAdmin && (
                      <option value="new">新規品目として登録（下の品名・規格で）</option>
                    )}
                  </select>
                </label>
                <label className="flex-1">
                  補足（任意）
                  <input
                    name="note"
                    placeholder="例：荷主に電話確認、新商品とのこと"
                    className="ml-1 w-2/3 rounded border px-1 py-0.5 dark:bg-neutral-900"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded border border-red-400 px-3 py-1 font-bold text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900"
                >
                  この内容で解消
                </button>
              </div>
              {isAdmin && (
                <div className="flex flex-wrap items-end gap-2 border-t border-red-200 pt-2 dark:border-red-900">
                  <span className="text-xs text-neutral-600 dark:text-neutral-400">
                    「新規品目として登録」の場合の登録内容（読取値から修正できます。修正は履歴に残ります）：
                  </span>
                  <label>
                    品名
                    <input
                      name="newItemName"
                      defaultValue={line.item_name_raw}
                      className="ml-1 w-48 rounded border px-1 py-0.5 dark:bg-neutral-900"
                    />
                  </label>
                  <label>
                    規格
                    <input
                      name="newItemSpec"
                      defaultValue={line.spec_raw}
                      className="ml-1 w-24 rounded border px-1 py-0.5 dark:bg-neutral-900"
                    />
                  </label>
                </div>
              )}
            </form>
          )}
          </div>
        ))}
      </section>

      {editable && (
        <div className="grid gap-4 md:grid-cols-2">
          <ConfirmBox slipId={slip.id} slipVersion={slip.version} operator={operator} />
          <form
            action={holdSlipAction}
            className="space-y-3 rounded border border-neutral-300 p-4 text-sm dark:border-neutral-700"
          >
            <h2 className="font-bold">保留にする</h2>
            <input type="hidden" name="slipId" value={slip.id} />
            <input type="hidden" name="slipVersion" value={slip.version} />
            <label className="block">
              保留理由（必須）
              <input
                name="reason"
                required
                placeholder="例：品名が既存在庫と似ているが不一致。荷主へ確認中"
                className="mt-1 w-full rounded border px-2 py-1 dark:bg-neutral-900"
              />
            </label>
            <button
              type="submit"
              className="rounded border border-red-300 px-4 py-2 font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            >
              保留にする
            </button>
          </form>
        </div>
      )}

      {slip.status === "hold" && (
        <form
          action={releaseSlipAction}
          className="space-y-3 rounded border border-neutral-300 p-4 text-sm dark:border-neutral-700"
        >
          <h2 className="font-bold">保留解除</h2>
          <input type="hidden" name="slipId" value={slip.id} />
          <input type="hidden" name="slipVersion" value={slip.version} />
          <button
            type="submit"
            className="rounded border px-4 py-2 font-bold hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            保留を解除して未処理に戻す
          </button>
        </form>
      )}

      <section className="space-y-2">
        <h2 className="font-bold">修正履歴（いつ・誰が・何を・なぜ）</h2>
        {history.length === 0 ? (
          <p className="text-sm text-neutral-500">履歴はまだありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[10%]" />
                <col className="w-[14%]" />
                <col className="w-[50%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="py-1 pr-3 font-normal">日時</th>
                  <th className="py-1 pr-3 font-normal">担当</th>
                  <th className="py-1 pr-3 font-normal">対象・操作</th>
                  <th className="py-1 pr-3 font-normal">内容（なぜ）</th>
                  <th className="py-1 pr-3 font-normal">変更値</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr
                    key={h.id}
                    className="border-b border-neutral-100 align-top dark:border-neutral-900"
                  >
                    <td className="py-1 pr-3">{h.created_at}</td>
                    <td className="break-words py-1 pr-3 font-mono">{h.operator}</td>
                    <td className="py-1 pr-3">
                      {h.target_type === "slip" ? "伝票" : `行${h.line_no ?? "?"}`}・
                      {{
                        create: "起票",
                        update: "修正",
                        confirm: "確定",
                        hold: "保留",
                        release: "解消",
                        adjust: "調整",
                        finalize: "月末確定",
                      }[h.action] ?? h.action}
                    </td>
                    <td className="break-words py-1 pr-3">{h.reason}</td>
                    <td className="break-words py-1 pr-3 font-mono text-xs">
                      {h.field
                        ? `${h.field}: ${h.old_value || "―"} → ${h.new_value || "―"}`
                        : "―"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
