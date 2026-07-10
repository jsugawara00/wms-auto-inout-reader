import { withTransaction, db } from "./db";

// 月末在庫の確定（企画書 6.6 / 8）
// - 月末残高をスナップショットとして確定・保存 → 翌月の期首になる（繰越テーブルは持たない）
// - 確定時点の名称・規格を非正規化コピーで保持（後からマスタが変わっても月末表は不変）
// - 二重確定は拒否。確定操作は edit_logs に記録（target_id = YYYYMM）

export type FinalizeResult =
  | { ok: true; message: string; rowCount: number }
  | { ok: false; message: string };

function monthToTargetId(month: string): number {
  return Number(month.replace("-", "")); // '2026-07' → 202607
}

export async function finalizeMonth(input: {
  month: string; // 'YYYY-MM'
  operator: string;
}): Promise<FinalizeResult> {
  const { month, operator } = input;
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, message: "対象月の形式が不正です（YYYY-MM）。" };
  }

  return withTransaction(async (conn): Promise<FinalizeResult> => {
    // 同一月の同時確定を防ぐ（MySQL版の COUNT(*) FOR UPDATE は Postgres では
    // 集約と併用できないため、advisory lock で代替）
    await conn.rows("SELECT pg_advisory_xact_lock(:lockKey)", {
      lockKey: monthToTargetId(month),
    });
    const existing = await conn.rows<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM stock_snapshots WHERE snapshot_month = :month",
      { month }
    );
    if (Number(existing[0].cnt) > 0) {
      return {
        ok: false,
        message: `${month} は確定済みです。確定後の修正は在庫の手修正＋履歴で行い、月末表は不変です。`,
      };
    }

    // 現在庫（数量0を除く）を確定時点の名称ごとコピー
    const inserted = await conn.exec(
      `INSERT INTO stock_snapshots
         (snapshot_month, warehouse_id, item_id, production_date, lot_no, order_no,
          quantity, shipper_name, item_name, spec, warehouse_code, finalized_by, finalized_at)
       SELECT :month, st.warehouse_id, st.item_id, st.production_date, st.lot_no, st.order_no,
              st.quantity, sh.name, i.name, i.spec, w.code, :operator, jst_now()
       FROM stock st
       JOIN items i ON i.id = st.item_id
       JOIN shippers sh ON sh.id = i.shipper_id
       JOIN warehouses w ON w.id = st.warehouse_id
       WHERE st.quantity <> 0`,
      { month, operator }
    );

    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
       VALUES ('snapshot', :targetId, 'finalize', :reason, :operator)`,
      {
        targetId: monthToTargetId(month),
        reason: `${month} 月末在庫を確定（${inserted}行）。この残高が翌月期首になる`,
        operator,
      }
    );
    return {
      ok: true,
      rowCount: inserted,
      message: `${month} の月末在庫を確定しました（${inserted}行）。`,
    };
  });
}

export interface SnapshotRow {
  id: number;
  snapshot_month: string;
  production_date: string | null;
  lot_no: string;
  order_no: string;
  quantity: number; // 原本値（不変）
  shipper_name: string;
  item_name: string;
  spec: string;
  warehouse_code: string;
  finalized_by: string;
  finalized_at: string;
  override_quantity: number | null; // 表示値修正（最新）。null=修正なし
}

/** 有効な表示数量（修正があれば修正値、なければ原本値） */
export function effectiveQuantity(row: SnapshotRow): number {
  return row.override_quantity ?? row.quantity;
}

export async function getSnapshot(month: string): Promise<SnapshotRow[]> {
  return db().rows<SnapshotRow>(
    `SELECT ss.*, o.override_quantity
     FROM stock_snapshots ss
     LEFT JOIN snapshot_overrides o ON o.id = (
       SELECT MAX(o2.id) FROM snapshot_overrides o2 WHERE o2.snapshot_id = ss.id
     )
     WHERE ss.snapshot_month = :month
     ORDER BY ss.shipper_name, ss.item_name, ss.spec,
              ss.production_date IS NULL, ss.production_date, ss.lot_no`,
    { month }
  );
}

// ------------------------------------------------------------------
// 表示値の修正（現場要件：メーカー入力漏れ等による確定後の数値合わせ。
// 本体は不変のまま、表示数量だけを差し替える。全修正が履歴に残る）
// ------------------------------------------------------------------

export type OverrideResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function addSnapshotOverride(input: {
  snapshotId: number;
  overrideQuantity: number;
  reason: string;
  operator: string;
}): Promise<OverrideResult> {
  const { snapshotId, overrideQuantity, reason, operator } = input;
  if (!reason.trim()) {
    return { ok: false, message: "修正理由は必須です（例：メーカー様帳簿との突合により）。" };
  }
  if (!Number.isFinite(overrideQuantity)) {
    return { ok: false, message: "数量が不正です。" };
  }

  return withTransaction(async (conn): Promise<OverrideResult> => {
    const rows = await conn.rows<SnapshotRow>(
      `SELECT ss.*, o.override_quantity
       FROM stock_snapshots ss
       LEFT JOIN snapshot_overrides o ON o.id = (
         SELECT MAX(o2.id) FROM snapshot_overrides o2 WHERE o2.snapshot_id = ss.id
       )
       WHERE ss.id = :snapshotId FOR UPDATE OF ss`,
      { snapshotId }
    );
    const row = rows[0];
    if (!row) return { ok: false, message: "月末表の行が見つかりません。" };

    const current = row.override_quantity ?? row.quantity;
    if (Number(current) === overrideQuantity) {
      return { ok: false, message: "現在の表示値と同じです。変更はありません。" };
    }

    await conn.exec(
      `INSERT INTO snapshot_overrides (snapshot_id, override_quantity, reason, operator)
       VALUES (:snapshotId, :overrideQuantity, :reason, :operator)`,
      { snapshotId, overrideQuantity, reason: reason.trim(), operator }
    );
    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, field, old_value, new_value, reason, operator)
       VALUES ('snapshot', :snapshotId, 'adjust', 'display_quantity', :oldValue, :newValue, :reason, :operator)`,
      {
        snapshotId,
        oldValue: String(current),
        newValue: String(overrideQuantity),
        reason: `月末表の表示値修正（原本 ${row.quantity} は不変）：${reason.trim()}`,
        operator,
      }
    );
    return {
      ok: true,
      message: `表示値を修正しました（${current} → ${overrideQuantity}。原本 ${row.quantity} は不変、履歴に記録済み）。`,
    };
  });
}

export interface OverrideHistoryRow {
  id: number;
  snapshot_id: number;
  override_quantity: number;
  reason: string;
  operator: string;
  created_at: string;
  item_name: string;
  spec: string;
  warehouse_code: string;
  production_date: string | null;
  lot_no: string;
  original_quantity: number;
}

/** 指定月の表示値修正の全履歴（社内確認用。印刷には出さない） */
export async function getOverrideHistory(month: string): Promise<OverrideHistoryRow[]> {
  return db().rows<OverrideHistoryRow>(
    `SELECT o.*, ss.item_name, ss.spec, ss.warehouse_code, ss.production_date,
            ss.lot_no, ss.quantity AS original_quantity
     FROM snapshot_overrides o
     JOIN stock_snapshots ss ON ss.id = o.snapshot_id
     WHERE ss.snapshot_month = :month
     ORDER BY o.id`,
    { month }
  );
}

export interface SnapshotMonth {
  snapshot_month: string;
  row_count: number;
  finalized_by: string;
  finalized_at: string;
}

export async function listSnapshotMonths(): Promise<SnapshotMonth[]> {
  return db().rows<SnapshotMonth>(
    `SELECT snapshot_month, COUNT(*) AS row_count,
            MIN(finalized_by) AS finalized_by, MIN(finalized_at) AS finalized_at
     FROM stock_snapshots GROUP BY snapshot_month ORDER BY snapshot_month DESC`
  );
}
