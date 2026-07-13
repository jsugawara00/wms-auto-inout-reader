import { notFound } from "next/navigation";
import { getInvoice, lineEffectiveAmount, type InvoiceLineRow } from "@/lib/billing";
import { currentRole } from "@/lib/auth";
import {
  adjustLineAction,
  addManualLineAction,
  deleteManualLineAction,
  recomputeAction,
  issueAction,
  reopenAction,
} from "./actions";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<InvoiceLineRow["category"], string> = {
  storage: "保管料",
  handling_in: "入庫荷役料",
  handling_out: "出庫荷役料",
  manual: "その他",
};

function categoryText(l: InvoiceLineRow): string {
  if (l.category === "storage") return `保管料 第${l.period_no}期`;
  return CATEGORY_LABEL[l.category];
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export default async function InvoiceDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { saved, error } = await searchParams;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId)) notFound();

  const [data, role] = await Promise.all([getInvoice(invoiceId), currentRole()]);
  if (!data) notFound();
  const { invoice, lines } = data;
  const isAdmin = role === "admin";
  const isDraft = invoice.status === "draft";
  const editable = isDraft && isAdmin;

  return (
    <div className="space-y-6">
      {saved && (
        <p className="rounded bg-green-50 p-2 text-sm text-green-700 print:hidden dark:bg-green-950 dark:text-green-300">{saved}</p>
      )}
      {error && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-700 print:hidden dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      {/* 状態バッジ（社内向け・印刷には出さない） */}
      <div className="flex items-baseline gap-3 print:hidden">
        <a href="/billing" className="text-sm text-blue-600 underline dark:text-blue-400">← 請求一覧</a>
        {isDraft ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-900 dark:text-amber-200">確認中（未発行）</span>
        ) : (
          <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs font-bold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">発行済み</span>
        )}
      </div>

      {/* ===== 請求書本体（印刷に出す） ===== */}
      <header className="space-y-1">
        <h1 className="text-xl font-bold">{invoice.invoice_month} 御請求書（税抜）</h1>
        <p className="text-lg">{invoice.shipper_name} 御中</p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-sm print:min-w-0">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[24%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1 pr-3 font-normal">区分</th>
              <th className="py-1 pr-3 font-normal">品名</th>
              <th className="py-1 pr-3 font-normal">規格</th>
              <th className="py-1 pr-3 text-right font-normal">数量</th>
              <th className="py-1 pr-3 text-right font-normal">単価</th>
              <th className="py-1 pr-3 text-right font-normal">金額</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const eff = lineEffectiveAmount(l);
              const adjusted = l.adjusted_amount !== null;
              return (
                <tr key={l.id} className="border-b border-neutral-100 align-top dark:border-neutral-900">
                  <td className="py-1 pr-3">{categoryText(l)}</td>
                  <td className="break-words py-1 pr-3">{l.item_name}</td>
                  <td className="break-words py-1 pr-3">{l.spec || "―"}</td>
                  <td className="py-1 pr-3 text-right font-mono">{Number(l.quantity)}</td>
                  <td className="py-1 pr-3 text-right font-mono">{Number(l.unit_price)}</td>
                  <td className="py-1 pr-3 text-right font-mono">
                    {eff.toLocaleString()}
                    {adjusted && (
                      <span className="block text-xs text-amber-600 print:hidden">
                        （調整済・原本 {Number(l.amount).toLocaleString()}）
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={5} className="py-2 pr-3 text-right font-bold">合計（税抜）</td>
              <td className="py-2 pr-3 text-right font-mono text-lg font-bold">{Number(invoice.total_amount).toLocaleString()} 円</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 発行済み: 発行情報＋印刷案内（印刷には出さない） */}
      {!isDraft && (
        <p className="text-xs text-neutral-500 print:hidden">
          発行：{invoice.issued_by}（{invoice.issued_at}）／ 印刷は Ctrl+P（請求書のみが出力されます）
        </p>
      )}

      {/* 発行済み: 修正のため再開（admin のみ・印刷には出さない） */}
      {!isDraft && isAdmin && (
        <section className="space-y-2 rounded border border-neutral-300 p-4 print:hidden dark:border-neutral-700">
          <h3 className="font-bold">修正のため再開する</h3>
          <p className="text-xs text-neutral-500">
            締めた後でも、荷主要望による荷役料・例外請求の追加や金額の調整が必要になることがあります。
            再開すると締めを解いて再編集でき、直したらあらためて発行します（理由は履歴に残ります）。
          </p>
          <form action={reopenAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <label className="flex-1">
              再開理由（必須）
              <input name="reason" required placeholder="例：8/1 に荷主要望で特別対応費を追加" className="ml-1 w-2/3 rounded border px-1 py-0.5 dark:bg-neutral-900" />
            </label>
            <button type="submit" className="rounded border border-amber-400 px-3 py-1 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950">
              🔓 修正のため再開する
            </button>
          </form>
        </section>
      )}

      {/* タリフ未設定などの警告（社内向け・印刷には出さない） */}
      {invoice.note && (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-700 print:hidden dark:bg-amber-950 dark:text-amber-300">
          ⚠️ {invoice.note}
        </p>
      )}

      {/* ===== 確認フォーム（draft かつ admin のみ・印刷には出さない） ===== */}
      {editable && (
        <div className="space-y-6 print:hidden">
          <hr className="border-neutral-200 dark:border-neutral-800" />
          <h2 className="text-lg font-bold">確認・調整（発行前）</h2>

          {/* 行金額の調整 */}
          <section className="space-y-2">
            <h3 className="font-bold">明細金額の調整</h3>
            <p className="text-xs text-neutral-500">
              個々の行の金額を調整できます（原本は不変・理由必須・履歴に残ります）。
            </p>
            <div className="space-y-1">
              {lines.map((l) => (
                <details key={l.id} className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
                  <summary className="cursor-pointer">
                    {categoryText(l)}・{l.item_name} {l.spec || ""} —{" "}
                    <span className="font-mono">{lineEffectiveAmount(l).toLocaleString()} 円</span>
                    {l.adjusted_amount !== null && <span className="text-xs text-amber-600">（調整済）</span>}
                  </summary>
                  <form action={adjustLineAction} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="invoiceId" value={invoice.id} />
                    <input type="hidden" name="lineId" value={l.id} />
                    <label>
                      調整後の金額
                      <input type="number" name="adjustedAmount" defaultValue={lineEffectiveAmount(l)} required className="ml-1 w-28 rounded border px-1 py-0.5 dark:bg-neutral-900" />
                    </label>
                    <label className="flex-1">
                      調整理由（必須）
                      <input name="reason" required placeholder="例：先方合意により端数調整" className="ml-1 w-2/3 rounded border px-1 py-0.5 dark:bg-neutral-900" />
                    </label>
                    <button type="submit" className="rounded border px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                      調整
                    </button>
                  </form>
                </details>
              ))}
            </div>
          </section>

          {/* 例外請求行 */}
          <section className="space-y-2">
            <h3 className="font-bold">例外請求行の追加</h3>
            <p className="text-xs text-neutral-500">
              保管料・作業料の他に発生した請求をここに追加できます（別Excelを作らずに1枚で完結）。
            </p>
            {lines.some((l) => l.category === "manual") && (
              <ul className="space-y-1 text-sm">
                {lines.filter((l) => l.category === "manual").map((l) => (
                  <li key={l.id} className="flex items-center gap-2">
                    <span>・{l.item_name} {l.spec || ""}：{Number(l.quantity)}×{Number(l.unit_price)}＝{lineEffectiveAmount(l).toLocaleString()} 円</span>
                    <form action={deleteManualLineAction}>
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <input type="hidden" name="lineId" value={l.id} />
                      <button type="submit" className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950">
                        削除
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={addManualLineAction} className="flex flex-wrap items-end gap-2 rounded border border-neutral-200 p-2 dark:border-neutral-800">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <label>
                請求項目
                <input name="itemName" required placeholder="例：特別対応費" className="ml-1 w-40 rounded border px-1 py-0.5 dark:bg-neutral-900" />
              </label>
              <label>
                規格(任意)
                <input name="spec" className="ml-1 w-24 rounded border px-1 py-0.5 dark:bg-neutral-900" />
              </label>
              <label>
                数量
                <input type="number" step="0.001" name="quantity" defaultValue={1} required className="ml-1 w-20 rounded border px-1 py-0.5 dark:bg-neutral-900" />
              </label>
              <label>
                単価
                <input type="number" step="0.0001" name="unitPrice" required className="ml-1 w-24 rounded border px-1 py-0.5 dark:bg-neutral-900" />
              </label>
              <button type="submit" className="rounded border px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                追加
              </button>
            </form>
          </section>

          {/* 再計算 */}
          <section className="space-y-2">
            <h3 className="font-bold">在庫等を修正した場合</h3>
            <p className="text-xs text-neutral-500">
              在庫や数量を直したら押してください。計算行を作り直します（追加した例外行は残ります）。
            </p>
            <form action={recomputeAction}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <button type="submit" className="rounded border px-4 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
                再計算する
              </button>
            </form>
          </section>

          {/* 発行 */}
          <section className="space-y-2 rounded border border-blue-300 p-4 dark:border-blue-800">
            <h3 className="font-bold">発行する</h3>
            <form action={issueAction} className="space-y-2">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="acknowledged" className="mt-1" />
                <span>この内容で発行します（印刷・送付用に締めます）。<strong>必要なら後から「修正のため再開」で直せます</strong>。</span>
              </label>
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
                この内容で発行する
              </button>
            </form>
          </section>
        </div>
      )}

      {isDraft && !isAdmin && (
        <p className="text-sm text-amber-700 print:hidden dark:text-amber-300">
          この請求書は確認中です。調整・発行には管理者権限が必要です（閲覧のみ）。
        </p>
      )}
    </div>
  );
}
