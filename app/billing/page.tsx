import Link from "next/link";
import { calcMonthlyBilling, listInvoices, type BillingPreview } from "@/lib/billing";
import { listShippers } from "@/lib/data";
import { currentRole } from "@/lib/auth";
import { createDraftAction } from "./actions";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ month?: string; shipper?: string; error?: string }>;
};

function currentMonthJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 7);
}

const yen = (n: number) => `${Number(n).toLocaleString()} 円`;

function PreviewTable({ preview }: { preview: BillingPreview }) {
  return (
    <div className="space-y-4">
      {preview.items.map((it) => {
        const subtotal = it.storageAmount + it.handlingInAmount + it.handlingOutAmount;
        return (
          <section key={it.itemId} className="space-y-1">
            <h3 className="font-bold">
              {it.itemName} {it.spec || "規格なし"}
              {it.tariffMissing && <span className="ml-2 text-xs text-red-600">タリフ未設定</span>}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[16%]" />
                  <col className="w-[14%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th className="py-1 pr-3 font-normal">区分</th>
                    <th className="py-1 pr-3 text-right font-normal">期首</th>
                    <th className="py-1 pr-3 text-right font-normal">入庫</th>
                    <th className="py-1 pr-3 text-right font-normal">出庫</th>
                    <th className="py-1 pr-3 text-right font-normal">課金数量</th>
                    <th className="py-1 pr-3 text-right font-normal">単価</th>
                    <th className="py-1 pr-3 text-right font-normal">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {it.periods.map((p) => (
                    <tr key={p.periodNo} className="border-b border-neutral-100 dark:border-neutral-900">
                      <td className="py-1 pr-3">保管料 第{p.periodNo}期</td>
                      <td className="py-1 pr-3 text-right font-mono">{p.openingQty}</td>
                      <td className="py-1 pr-3 text-right font-mono">{p.inQty}</td>
                      <td className="py-1 pr-3 text-right font-mono">{p.outQty}</td>
                      <td className="py-1 pr-3 text-right font-mono">{p.billableQty}</td>
                      <td className="py-1 pr-3 text-right font-mono">{it.storageRate}</td>
                      <td className="py-1 pr-3 text-right font-mono">{p.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                  {it.monthInQty > 0 && (
                    <tr className="border-b border-neutral-100 dark:border-neutral-900">
                      <td className="py-1 pr-3">入庫荷役料</td>
                      <td className="py-1 pr-3" />
                      <td className="py-1 pr-3 text-right font-mono">{it.monthInQty}</td>
                      <td className="py-1 pr-3" />
                      <td className="py-1 pr-3 text-right font-mono">{it.monthInQty}</td>
                      <td className="py-1 pr-3 text-right font-mono">{it.handlingInRate}</td>
                      <td className="py-1 pr-3 text-right font-mono">{it.handlingInAmount.toLocaleString()}</td>
                    </tr>
                  )}
                  {it.monthOutQty > 0 && (
                    <tr className="border-b border-neutral-100 dark:border-neutral-900">
                      <td className="py-1 pr-3">出庫荷役料</td>
                      <td className="py-1 pr-3" />
                      <td className="py-1 pr-3" />
                      <td className="py-1 pr-3 text-right font-mono">{it.monthOutQty}</td>
                      <td className="py-1 pr-3 text-right font-mono">{it.monthOutQty}</td>
                      <td className="py-1 pr-3 text-right font-mono">{it.handlingOutRate}</td>
                      <td className="py-1 pr-3 text-right font-mono">{it.handlingOutAmount.toLocaleString()}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={6} className="py-1 pr-3 text-right text-neutral-500">品目小計</td>
                    <td className="py-1 pr-3 text-right font-mono font-bold">{subtotal.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default async function BillingPage({ searchParams }: Props) {
  const { month, shipper, error } = await searchParams;
  const [shippers, invoices, role] = await Promise.all([
    listShippers(),
    listInvoices(),
    currentRole(),
  ]);
  const isAdmin = role === "admin";

  const selMonth = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : null;
  const selShipperId = shipper ? Number(shipper) : null;
  const preview =
    selMonth && selShipperId
      ? await calcMonthlyBilling(selShipperId, selMonth)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">請求</h1>
        <a href="/masters/tariffs" className="text-sm text-blue-600 underline dark:text-blue-400">タリフ管理へ</a>
      </div>

      {error && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      <section className="space-y-3 rounded border border-neutral-300 p-4 text-sm dark:border-neutral-700">
        <h2 className="font-bold">請求を計算する（税抜）</h2>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label>
            対象月
            <input type="month" name="month" defaultValue={selMonth ?? currentMonthJst()} required className="ml-1 rounded border px-2 py-1 dark:bg-neutral-900" />
          </label>
          <label>
            荷主
            <select name="shipper" defaultValue={selShipperId ?? ""} required className="ml-1 rounded border px-2 py-1 dark:bg-neutral-900">
              <option value="" disabled>選択</option>
              {shippers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded border px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            計算する
          </button>
        </form>
      </section>

      {preview && "error" in preview && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{preview.error}</p>
      )}

      {preview && !("error" in preview) && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold">
            {preview.month} 「{preview.shipperName}」の請求（下見・税抜）
          </h2>

          {preview.warnings.length > 0 && (
            <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
              {preview.warnings.map((w, i) => (
                <p key={i}>⚠️ {w}</p>
              ))}
              <p className="text-xs">
                → <a href="/masters/tariffs" className="text-blue-600 underline dark:text-blue-400">タリフ管理</a> で単価を登録し、もう一度「計算する」を押してください。
              </p>
            </div>
          )}

          {preview.items.length === 0 ? (
            <p className="text-sm text-neutral-500">対象月に在庫・入出庫がありません。</p>
          ) : (
            <>
              <PreviewTable preview={preview} />
              <p className="text-right text-lg font-bold">合計（税抜）：{yen(preview.totalAmount)}</p>

              {isAdmin ? (
                <form action={createDraftAction} className="rounded border border-neutral-300 p-4 dark:border-neutral-700">
                  <input type="hidden" name="shipperId" value={preview.shipperId} />
                  <input type="hidden" name="month" value={preview.month} />
                  <p className="mb-2 text-sm text-neutral-500">
                    この内容で締めると請求書の下書きを作成し、確認画面へ進みます（まだ発行ではありません）。
                  </p>
                  <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
                    この内容で締める（確認画面へ）
                  </button>
                </form>
              ) : (
                <p className="text-sm text-amber-700 dark:text-amber-300">締め・発行には管理者権限が必要です（閲覧のみ）。</p>
              )}
            </>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-bold">請求書一覧</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-neutral-500">請求書はまだありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-neutral-500">
                  <th className="py-1 pr-3 font-normal">対象月</th>
                  <th className="py-1 pr-3 font-normal">荷主</th>
                  <th className="py-1 pr-3 font-normal">状態</th>
                  <th className="py-1 pr-3 text-right font-normal">合計(税抜)</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-neutral-100 dark:border-neutral-900">
                    <td className="py-1 pr-3">
                      <Link href={`/billing/${inv.id}`} className="font-mono text-blue-600 underline dark:text-blue-400">
                        {inv.invoice_month}
                      </Link>
                    </td>
                    <td className="py-1 pr-3">{inv.shipper_name}</td>
                    <td className="py-1 pr-3">
                      {inv.status === "issued" ? (
                        <span className="text-neutral-500">発行済み</span>
                      ) : (
                        <span className="font-bold text-amber-600">確認中</span>
                      )}
                    </td>
                    <td className="py-1 pr-3 text-right font-mono">{Number(inv.total_amount).toLocaleString()}</td>
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
