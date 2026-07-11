import { db, withTransaction } from "./db";

// 請求処理（保管料三期制・荷役料）— 計算コア（仕様候補§2の商品化・Fable設計）
//
// 設計原則:
// - 請求は「確定済みデータの上の決定的計算」。stock の現在値には依存せず、
//   前月末スナップショットの表示値 ＋ 確定済み伝票（入出庫日基準）から導出する。
// - 三期制（倉庫業標準）: 1期=1〜10日 / 2期=11〜20日 / 3期=21〜月末。
//   各期の保管料対象数量 = 期首在庫 + 期中入庫（期中出庫は当期の課金対象から引かない）。
// - 期首在庫の起点は前月末スナップショットの「表示値」（先方と合意した数字で請求する。
//   表示値修正の思想と接続）。スナップショットが無い月は 0 から開始。
// - 荷役料 = 月間入庫数量×入庫単価 + 月間出庫数量×出庫単価。
// - タリフ解決は 品目一致 → 荷主既定（item_id IS NULL）の順。無ければ金額0で
//   警告に載せる（黙って落とさない。担当がタリフを登録して再計算する）。
// - 金額は円未満切り捨て。
// - 請求書の確定は月末表と同じ流儀: 原本不変・二重確定拒否・履歴記録。

export interface TariffRow {
  id: number;
  shipper_id: number;
  item_id: number | null;
  storage_rate: number;
  handling_in_rate: number;
  handling_out_rate: number;
  note: string;
  item_name?: string | null;
  item_spec?: string | null;
}

export async function listTariffs(shipperId?: number): Promise<TariffRow[]> {
  const where = shipperId ? "WHERE t.shipper_id = :shipperId" : "";
  return db().rows<TariffRow>(
    `SELECT t.*, i.name AS item_name, i.spec AS item_spec
     FROM tariffs t LEFT JOIN items i ON i.id = t.item_id
     ${where}
     ORDER BY t.shipper_id, t.item_id NULLS FIRST`,
    shipperId ? { shipperId } : {}
  );
}

export type BillingResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/** タリフの登録・更新（荷主既定は itemId=null）。履歴記録つき */
export async function upsertTariff(input: {
  shipperId: number;
  itemId: number | null;
  storageRate: number;
  handlingInRate: number;
  handlingOutRate: number;
  note: string;
  operator: string;
}): Promise<BillingResult> {
  const { shipperId, itemId, storageRate, handlingInRate, handlingOutRate, note, operator } = input;
  for (const [label, v] of [["保管料", storageRate], ["入庫荷役料", handlingInRate], ["出庫荷役料", handlingOutRate]] as const) {
    if (!Number.isFinite(v) || v < 0) return { ok: false, message: `${label}の単価が不正です。` };
  }
  return withTransaction(async (conn): Promise<BillingResult> => {
    const rows = await conn.rows<{ id: number }>(
      `INSERT INTO tariffs (shipper_id, item_id, storage_rate, handling_in_rate, handling_out_rate, note)
       VALUES (:shipperId, :itemId, :storageRate, :handlingInRate, :handlingOutRate, :note)
       ON CONFLICT (shipper_id, item_key) DO UPDATE SET
         storage_rate = EXCLUDED.storage_rate,
         handling_in_rate = EXCLUDED.handling_in_rate,
         handling_out_rate = EXCLUDED.handling_out_rate,
         note = EXCLUDED.note
       RETURNING id`,
      { shipperId, itemId, storageRate, handlingInRate, handlingOutRate, note: note.trim() }
    );
    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
       VALUES ('tariff', :id, 'update', :reason, :operator)`,
      {
        id: rows[0].id,
        reason: `タリフ登録/更新（保管 ${storageRate}・入庫 ${handlingInRate}・出庫 ${handlingOutRate}）`,
        operator,
      }
    );
    return { ok: true, message: "タリフを保存しました。" };
  });
}

// ------------------------------------------------------------------
// 三期制の計算
// ------------------------------------------------------------------

export interface StoragePeriodDetail {
  periodNo: 1 | 2 | 3;
  openingQty: number; // 期首在庫
  inQty: number; // 期中入庫
  outQty: number; // 期中出庫
  billableQty: number; // 課金対象 = 期首 + 期中入庫
  amount: number; // 円未満切り捨て
}

export interface BillingItemDetail {
  itemId: number;
  itemName: string;
  spec: string;
  storageRate: number;
  handlingInRate: number;
  handlingOutRate: number;
  tariffMissing: boolean; // タリフ未設定（金額0で計上・警告）
  periods: StoragePeriodDetail[];
  monthInQty: number;
  monthOutQty: number;
  storageAmount: number;
  handlingInAmount: number;
  handlingOutAmount: number;
}

export interface BillingPreview {
  shipperId: number;
  shipperName: string;
  month: string; // 'YYYY-MM'
  items: BillingItemDetail[];
  totalAmount: number;
  warnings: string[];
}

function lastDayOfMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function periodOf(dateStr: string): 1 | 2 | 3 {
  const day = Number(dateStr.slice(8, 10));
  return day <= 10 ? 1 : day <= 20 ? 2 : 3;
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const floor = (n: number) => Math.floor(n);

/** 指定荷主×指定月の請求内容を計算する（保存はしない。決定的・何度でも実行可） */
export async function calcMonthlyBilling(
  shipperId: number,
  month: string
): Promise<BillingPreview | { error: string }> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: "対象月の形式が不正です（YYYY-MM）。" };

  const shippers = await db().rows<{ id: number; name: string }>(
    "SELECT id, name FROM shippers WHERE id = :shipperId",
    { shipperId }
  );
  if (shippers.length === 0) return { error: "荷主が見つかりません。" };
  const shipperName = shippers[0].name;

  // 期首在庫の起点：前月末スナップショットの表示値（override 最新 or 原本）を品目単位に集約
  const opening = await db().rows<{ item_id: number; qty: number }>(
    `SELECT ss.item_id, SUM(COALESCE(o.override_quantity, ss.quantity)) AS qty
     FROM stock_snapshots ss
     LEFT JOIN snapshot_overrides o ON o.id = (
       SELECT MAX(o2.id) FROM snapshot_overrides o2 WHERE o2.snapshot_id = ss.id
     )
     JOIN items i ON i.id = ss.item_id
     WHERE ss.snapshot_month = :prevMonth AND i.shipper_id = :shipperId
     GROUP BY ss.item_id`,
    { prevMonth: prevMonth(month), shipperId }
  );

  // 当月の確定済み伝票明細（入出庫日基準）
  const moves = await db().rows<{
    item_id: number;
    slip_type: "inbound" | "outbound";
    movement_date: string;
    qty: number;
  }>(
    `SELECT l.item_id, s.slip_type, s.movement_date, SUM(l.quantity) AS qty
     FROM slips s
     JOIN slip_lines l ON l.slip_id = s.id
     WHERE s.status = 'done' AND s.shipper_id = :shipperId
       AND l.item_id IS NOT NULL
       AND to_char(s.movement_date, 'YYYY-MM') = :month
     GROUP BY l.item_id, s.slip_type, s.movement_date`,
    { shipperId, month }
  );

  // 対象品目 = 期首在庫あり ∪ 当月動きあり
  const itemIds = [...new Set([...opening.map((o) => o.item_id), ...moves.map((m) => m.item_id)])];
  if (itemIds.length === 0) {
    return { shipperId, shipperName, month, items: [], totalAmount: 0, warnings: ["対象月に在庫・入出庫がありません。"] };
  }

  const itemRows = await db().rows<{ id: number; name: string; spec: string }>(
    `SELECT id, name, spec FROM items WHERE id = ANY(:ids::int[])`,
    { ids: `{${itemIds.join(",")}}` }
  );
  const tariffs = await listTariffs(shipperId);
  const defaultTariff = tariffs.find((t) => t.item_id === null) ?? null;

  const warnings: string[] = [];
  const items: BillingItemDetail[] = [];

  for (const item of itemRows.sort((a, b) => (a.name + a.spec).localeCompare(b.name + b.spec, "ja"))) {
    const tariff = tariffs.find((t) => t.item_id === item.id) ?? defaultTariff;
    const tariffMissing = !tariff;
    if (tariffMissing) {
      warnings.push(`「${item.name} ${item.spec || "規格なし"}」のタリフが未設定です（金額0で計上）。タリフ登録後に再計算してください。`);
    }
    const storageRate = Number(tariff?.storage_rate ?? 0);
    const handlingInRate = Number(tariff?.handling_in_rate ?? 0);
    const handlingOutRate = Number(tariff?.handling_out_rate ?? 0);

    const openQty = Number(opening.find((o) => o.item_id === item.id)?.qty ?? 0);
    const inP = [0, 0, 0];
    const outP = [0, 0, 0];
    for (const m of moves.filter((m) => m.item_id === item.id)) {
      const p = periodOf(m.movement_date) - 1;
      if (m.slip_type === "inbound") inP[p] += Number(m.qty);
      else outP[p] += Number(m.qty);
    }

    const periods: StoragePeriodDetail[] = [];
    let open = openQty;
    let storageAmount = 0;
    for (let p = 0; p < 3; p++) {
      const billable = open + inP[p];
      const amount = floor(billable * storageRate);
      periods.push({
        periodNo: (p + 1) as 1 | 2 | 3,
        openingQty: open,
        inQty: inP[p],
        outQty: outP[p],
        billableQty: billable,
        amount,
      });
      storageAmount += amount;
      open = open + inP[p] - outP[p]; // 期末 = 次期首
    }

    const monthInQty = inP[0] + inP[1] + inP[2];
    const monthOutQty = outP[0] + outP[1] + outP[2];
    const handlingInAmount = floor(monthInQty * handlingInRate);
    const handlingOutAmount = floor(monthOutQty * handlingOutRate);

    items.push({
      itemId: item.id,
      itemName: item.name,
      spec: item.spec,
      storageRate,
      handlingInRate,
      handlingOutRate,
      tariffMissing,
      periods,
      monthInQty,
      monthOutQty,
      storageAmount,
      handlingInAmount,
      handlingOutAmount,
    });
  }

  const totalAmount = items.reduce(
    (s, it) => s + it.storageAmount + it.handlingInAmount + it.handlingOutAmount,
    0
  );
  return { shipperId, shipperName, month, items, totalAmount, warnings };
}

// ------------------------------------------------------------------
// 請求書の「締め → 確認フォーム → 発行（印刷可）」（1-15 / 1-16）
// - 締める＝計算値を下書き(draft)として保存（原本。amount は不変）
// - 確認フォームで：行金額の調整（adjusted_amount＝表示調整層）／例外行(manual)の追加・削除／
//   在庫を直した後の再計算（recompute）ができる（すべて draft のときのみ）
// - 発行(issue)で issued に。以後は不変・印刷可（月末表・表示値修正と同じ思想）
// ------------------------------------------------------------------

export type InvoiceActionResult =
  | { ok: true; message: string; invoiceId: number }
  | { ok: false; message: string };

type Conn = Parameters<Parameters<typeof withTransaction>[0]>[0];

/** 計算プレビューの明細を invoice_lines へ書き出す（storage/handling_in/handling_out） */
async function writeComputedLines(
  conn: Conn,
  invoiceId: number,
  preview: BillingPreview,
  startLineNo: number
): Promise<number> {
  let lineNo = startLineNo;
  for (const it of preview.items) {
    for (const p of it.periods) {
      if (p.billableQty === 0 && p.amount === 0) continue; // 空期はスキップ
      lineNo++;
      await conn.exec(
        `INSERT INTO invoice_lines (invoice_id, line_no, category, item_name, spec, period_no, quantity, unit_price, amount)
         VALUES (:invoiceId, :lineNo, 'storage', :itemName, :spec, :periodNo, :quantity, :unitPrice, :amount)`,
        { invoiceId, lineNo, itemName: it.itemName, spec: it.spec, periodNo: p.periodNo, quantity: p.billableQty, unitPrice: it.storageRate, amount: p.amount }
      );
    }
    if (it.monthInQty > 0) {
      lineNo++;
      await conn.exec(
        `INSERT INTO invoice_lines (invoice_id, line_no, category, item_name, spec, period_no, quantity, unit_price, amount)
         VALUES (:invoiceId, :lineNo, 'handling_in', :itemName, :spec, NULL, :quantity, :unitPrice, :amount)`,
        { invoiceId, lineNo, itemName: it.itemName, spec: it.spec, quantity: it.monthInQty, unitPrice: it.handlingInRate, amount: it.handlingInAmount }
      );
    }
    if (it.monthOutQty > 0) {
      lineNo++;
      await conn.exec(
        `INSERT INTO invoice_lines (invoice_id, line_no, category, item_name, spec, period_no, quantity, unit_price, amount)
         VALUES (:invoiceId, :lineNo, 'handling_out', :itemName, :spec, NULL, :quantity, :unitPrice, :amount)`,
        { invoiceId, lineNo, itemName: it.itemName, spec: it.spec, quantity: it.monthOutQty, unitPrice: it.handlingOutRate, amount: it.handlingOutAmount }
      );
    }
  }
  return lineNo;
}

/** 請求書合計を明細の表示値（adjusted_amount ?? amount）から再計算して保存 */
async function recalcInvoiceTotal(conn: Conn, invoiceId: number): Promise<void> {
  await conn.exec(
    `UPDATE invoices SET total_amount = (
       SELECT COALESCE(SUM(COALESCE(adjusted_amount, amount)), 0)
       FROM invoice_lines WHERE invoice_id = :invoiceId
     ) WHERE id = :invoiceId`,
    { invoiceId }
  );
}

async function loadDraft(conn: Conn, invoiceId: number): Promise<InvoiceRow | null> {
  const rows = await conn.rows<InvoiceRow>(
    "SELECT * FROM invoices WHERE id = :invoiceId FOR UPDATE",
    { invoiceId }
  );
  return rows[0] ?? null;
}

/** 締める：計算値を下書き(draft)として保存。同一 月×荷主 が既にあれば拒否 */
export async function createDraftInvoice(input: {
  shipperId: number;
  month: string;
  operator: string;
}): Promise<InvoiceActionResult> {
  const { shipperId, month, operator } = input;
  const preview = await calcMonthlyBilling(shipperId, month);
  if ("error" in preview) return { ok: false, message: preview.error };
  if (preview.items.length === 0) {
    return { ok: false, message: "対象月に在庫・入出庫が無いため、請求書を作成できません。" };
  }

  return withTransaction(async (conn): Promise<InvoiceActionResult> => {
    await conn.rows("SELECT pg_advisory_xact_lock(:k1, :k2)", {
      k1: Number(month.replace("-", "")), k2: shipperId,
    });
    const dup = await conn.rows<{ id: number; status: string }>(
      "SELECT id, status FROM invoices WHERE invoice_month = :month AND shipper_id = :shipperId",
      { month, shipperId }
    );
    if (dup.length > 0) {
      const s = dup[0].status === "issued" ? "発行済み" : "作成済み（確認中）";
      return { ok: false, message: `${month} の「${preview.shipperName}」宛請求書は既に${s}です（#${dup[0].id}）。確認画面から操作してください。` };
    }

    const inv = await conn.rows<{ id: number }>(
      `INSERT INTO invoices (invoice_month, shipper_id, shipper_name, total_amount, note, status, finalized_by)
       VALUES (:month, :shipperId, :shipperName, :totalAmount, :note, 'draft', :operator)
       RETURNING id`,
      { month, shipperId, shipperName: preview.shipperName, totalAmount: preview.totalAmount, note: preview.warnings.join(" / "), operator }
    );
    const invoiceId = inv[0].id;
    await writeComputedLines(conn, invoiceId, preview, 0);
    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
       VALUES ('invoice', :invoiceId, 'create', :reason, :operator)`,
      { invoiceId, reason: `${month} 「${preview.shipperName}」宛請求書を締め（下書き作成・合計 ${preview.totalAmount} 円）`, operator }
    );
    return { ok: true, invoiceId, message: `${month} の請求書を締めました（確認画面で内容を確認してください）。` };
  });
}

/** 再計算：在庫等の修正後、下書きの計算行を作り直す（例外行 manual は保持） */
export async function recomputeDraft(input: {
  invoiceId: number;
  operator: string;
}): Promise<InvoiceActionResult> {
  const { invoiceId, operator } = input;
  return withTransaction(async (conn): Promise<InvoiceActionResult> => {
    const inv = await loadDraft(conn, invoiceId);
    if (!inv) return { ok: false, message: "請求書が見つかりません。" };
    if (inv.status !== "draft") return { ok: false, message: "発行済みの請求書は再計算できません（不変）。" };

    const preview = await calcMonthlyBilling(inv.shipper_id, inv.invoice_month);
    if ("error" in preview) return { ok: false, message: preview.error };

    // 計算行（manual以外）を作り直し、例外行は温存。line_no は manual の後ろに採番
    await conn.exec("DELETE FROM invoice_lines WHERE invoice_id = :invoiceId AND category <> 'manual'", { invoiceId });
    const maxRows = await conn.rows<{ n: number }>(
      "SELECT COALESCE(MAX(line_no), 0) AS n FROM invoice_lines WHERE invoice_id = :invoiceId", { invoiceId }
    );
    await writeComputedLines(conn, invoiceId, preview, Number(maxRows[0].n));
    await conn.exec("UPDATE invoices SET note = :note WHERE id = :invoiceId", { note: preview.warnings.join(" / "), invoiceId });
    await recalcInvoiceTotal(conn, invoiceId);
    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
       VALUES ('invoice', :invoiceId, 'update', '在庫等の修正を反映して計算行を再計算（例外行は保持）', :operator)`,
      { invoiceId, operator }
    );
    return { ok: true, invoiceId, message: "在庫等の内容を反映して再計算しました。" };
  });
}

/** 行金額の調整（表示値修正。原本 amount は不変・理由必須・履歴） */
export async function adjustInvoiceLine(input: {
  lineId: number;
  adjustedAmount: number;
  reason: string;
  operator: string;
}): Promise<InvoiceActionResult> {
  const { lineId, adjustedAmount, reason, operator } = input;
  if (!reason.trim()) return { ok: false, message: "調整理由は必須です。" };
  if (!Number.isFinite(adjustedAmount)) return { ok: false, message: "金額が不正です。" };

  return withTransaction(async (conn): Promise<InvoiceActionResult> => {
    const rows = await conn.rows<{ invoice_id: number; amount: number; status: string }>(
      `SELECT l.invoice_id, l.amount, i.status
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
       WHERE l.id = :lineId FOR UPDATE OF i`,
      { lineId }
    );
    const row = rows[0];
    if (!row) return { ok: false, message: "明細が見つかりません。" };
    if (row.status !== "draft") return { ok: false, message: "発行済みの請求書は調整できません（不変）。" };

    await conn.exec(
      "UPDATE invoice_lines SET adjusted_amount = :adjustedAmount, adjust_reason = :reason WHERE id = :lineId",
      { adjustedAmount, reason: reason.trim(), lineId }
    );
    await recalcInvoiceTotal(conn, row.invoice_id);
    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, field, old_value, new_value, reason, operator)
       VALUES ('invoice', :invoiceId, 'adjust', 'line_amount', :oldValue, :newValue, :reason, :operator)`,
      { invoiceId: row.invoice_id, oldValue: String(row.amount), newValue: String(adjustedAmount), reason: reason.trim(), operator }
    );
    return { ok: true, invoiceId: row.invoice_id, message: `明細金額を調整しました（原本 ${row.amount} は不変・履歴に記録）。` };
  });
}

/** 例外請求行の追加（1-16。別Excel請求の吸収。数量×単価＝金額、円未満切り捨て） */
export async function addManualLine(input: {
  invoiceId: number;
  itemName: string;
  spec: string;
  quantity: number;
  unitPrice: number;
  operator: string;
}): Promise<InvoiceActionResult> {
  const { invoiceId, itemName, spec, quantity, unitPrice, operator } = input;
  if (!itemName.trim()) return { ok: false, message: "請求項目名を入力してください。" };
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return { ok: false, message: "数量・単価が不正です。" };

  return withTransaction(async (conn): Promise<InvoiceActionResult> => {
    const inv = await loadDraft(conn, invoiceId);
    if (!inv) return { ok: false, message: "請求書が見つかりません。" };
    if (inv.status !== "draft") return { ok: false, message: "発行済みの請求書には追加できません（不変）。" };

    const amount = floor(quantity * unitPrice);
    const maxRows = await conn.rows<{ n: number }>(
      "SELECT COALESCE(MAX(line_no), 0) AS n FROM invoice_lines WHERE invoice_id = :invoiceId", { invoiceId }
    );
    await conn.exec(
      `INSERT INTO invoice_lines (invoice_id, line_no, category, item_name, spec, period_no, quantity, unit_price, amount)
       VALUES (:invoiceId, :lineNo, 'manual', :itemName, :spec, NULL, :quantity, :unitPrice, :amount)`,
      { invoiceId, lineNo: Number(maxRows[0].n) + 1, itemName: itemName.trim(), spec: spec.trim(), quantity, unitPrice, amount }
    );
    await recalcInvoiceTotal(conn, invoiceId);
    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
       VALUES ('invoice', :invoiceId, 'update', :reason, :operator)`,
      { invoiceId, reason: `例外請求行を追加：${itemName.trim()} ${quantity}×${unitPrice}=${amount}円`, operator }
    );
    return { ok: true, invoiceId, message: `例外請求行「${itemName.trim()}」を追加しました（${amount} 円）。` };
  });
}

/** 例外請求行の削除（manual のみ・draft のみ） */
export async function deleteManualLine(input: {
  lineId: number;
  operator: string;
}): Promise<InvoiceActionResult> {
  const { lineId, operator } = input;
  return withTransaction(async (conn): Promise<InvoiceActionResult> => {
    const rows = await conn.rows<{ invoice_id: number; category: string; status: string; item_name: string }>(
      `SELECT l.invoice_id, l.category, l.item_name, i.status
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
       WHERE l.id = :lineId FOR UPDATE OF i`,
      { lineId }
    );
    const row = rows[0];
    if (!row) return { ok: false, message: "明細が見つかりません。" };
    if (row.status !== "draft") return { ok: false, message: "発行済みの請求書は編集できません（不変）。" };
    if (row.category !== "manual") return { ok: false, message: "計算された明細は削除できません（調整で対応してください）。" };

    await conn.exec("DELETE FROM invoice_lines WHERE id = :lineId", { lineId });
    await recalcInvoiceTotal(conn, row.invoice_id);
    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
       VALUES ('invoice', :invoiceId, 'update', :reason, :operator)`,
      { invoiceId: row.invoice_id, reason: `例外請求行を削除：${row.item_name}`, operator }
    );
    return { ok: true, invoiceId: row.invoice_id, message: "例外請求行を削除しました。" };
  });
}

/** 発行：draft → issued。以後は不変・印刷可 */
export async function issueInvoice(input: {
  invoiceId: number;
  operator: string;
}): Promise<InvoiceActionResult> {
  const { invoiceId, operator } = input;
  return withTransaction(async (conn): Promise<InvoiceActionResult> => {
    const inv = await loadDraft(conn, invoiceId);
    if (!inv) return { ok: false, message: "請求書が見つかりません。" };
    if (inv.status === "issued") return { ok: false, message: "この請求書は既に発行済みです（不変）。" };

    await recalcInvoiceTotal(conn, invoiceId);
    await conn.exec(
      "UPDATE invoices SET status = 'issued', issued_by = :operator, issued_at = jst_now() WHERE id = :invoiceId",
      { operator, invoiceId }
    );
    const totalRows = await conn.rows<{ total_amount: number }>(
      "SELECT total_amount FROM invoices WHERE id = :invoiceId", { invoiceId }
    );
    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
       VALUES ('invoice', :invoiceId, 'finalize', :reason, :operator)`,
      { invoiceId, reason: `請求書を発行（確認完了・以後不変・合計 ${totalRows[0].total_amount} 円）`, operator }
    );
    return { ok: true, invoiceId, message: `請求書を発行しました（印刷可能・合計 ${Number(totalRows[0].total_amount).toLocaleString()} 円）。` };
  });
}

export interface InvoiceRow {
  id: number;
  invoice_month: string;
  shipper_id: number;
  shipper_name: string;
  total_amount: number;
  note: string;
  status: "draft" | "issued";
  finalized_by: string;
  finalized_at: string;
  issued_by: string | null;
  issued_at: string | null;
}

export interface InvoiceLineRow {
  id: number;
  line_no: number;
  category: "storage" | "handling_in" | "handling_out" | "manual";
  item_name: string;
  spec: string;
  period_no: number | null;
  quantity: number;
  unit_price: number;
  amount: number; // 原本（計算値。manual は入力値）
  adjusted_amount: number | null; // 表示調整（NULL=無調整）
  adjust_reason: string | null;
}

/** 明細の有効金額（調整があれば調整値、なければ原本） */
export function lineEffectiveAmount(l: InvoiceLineRow): number {
  return l.adjusted_amount ?? l.amount;
}

export async function listInvoices(): Promise<InvoiceRow[]> {
  return db().rows<InvoiceRow>(
    "SELECT * FROM invoices ORDER BY invoice_month DESC, shipper_name"
  );
}

export async function getInvoice(
  id: number
): Promise<{ invoice: InvoiceRow; lines: InvoiceLineRow[] } | null> {
  const invs = await db().rows<InvoiceRow>("SELECT * FROM invoices WHERE id = :id", { id });
  if (invs.length === 0) return null;
  const lines = await db().rows<InvoiceLineRow>(
    "SELECT * FROM invoice_lines WHERE invoice_id = :id ORDER BY line_no",
    { id }
  );
  return { invoice: invs[0], lines };
}
