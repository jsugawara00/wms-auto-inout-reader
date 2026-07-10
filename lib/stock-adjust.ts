import { withTransaction } from "./db";
import type { StockRow } from "./types";

// 在庫数量の手修正（企画書 6.7）
// 「起きたときに追える・直せる」：修正は理由必須、いつ・誰が・何を・なぜ を必ず記録。

export type AdjustResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function adjustStock(input: {
  stockId: number;
  expectedVersion: number;
  newQuantity: number;
  reason: string;
  operator: string;
}): Promise<AdjustResult> {
  const { stockId, expectedVersion, newQuantity, reason, operator } = input;
  if (!reason.trim()) {
    return { ok: false, message: "修正理由は必須です（監査・社内説明で「なぜ直したか」を示すため）。" };
  }
  if (!Number.isFinite(newQuantity)) {
    return { ok: false, message: "数量が不正です。" };
  }

  return withTransaction(async (conn): Promise<AdjustResult> => {
    const rows = await conn.rows<StockRow>(
      "SELECT * FROM stock WHERE id = :stockId FOR UPDATE",
      { stockId }
    );
    const stock = rows[0];
    if (!stock) return { ok: false, message: "在庫行が見つかりません。" };
    if (stock.version !== expectedVersion) {
      return {
        ok: false,
        message: "他の担当者がこの在庫を更新しました。最新表示を確認してから修正してください。",
      };
    }
    if (Number(stock.quantity) === newQuantity) {
      return { ok: false, message: "数量に変更がありません。" };
    }

    await conn.exec(
      "UPDATE stock SET quantity = :newQuantity, version = version + 1 WHERE id = :stockId",
      { newQuantity, stockId }
    );
    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, field, old_value, new_value, reason, operator)
       VALUES ('stock', :stockId, 'adjust', 'quantity', :oldValue, :newValue, :reason, :operator)`,
      {
        stockId,
        oldValue: String(stock.quantity),
        newValue: String(newQuantity),
        reason: reason.trim(),
        operator,
      }
    );
    return {
      ok: true,
      message: `在庫を手修正しました（${stock.quantity} → ${newQuantity}。履歴に記録済み）。`,
    };
  });
}
