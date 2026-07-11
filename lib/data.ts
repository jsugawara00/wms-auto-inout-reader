import { db } from "./db";
import type { Slip, SlipLine, SlipStatus, SlipType, Shipper, Warehouse } from "./types";

export interface SlipListRow extends Slip {
  shipper_name: string | null;
  line_count: number;
}

export async function listSlips(status?: SlipStatus): Promise<SlipListRow[]> {
  const where = status ? "WHERE s.status = :status" : "";
  return db().rows<SlipListRow>(
    `SELECT s.*, sh.name AS shipper_name,
            (SELECT COUNT(*) FROM slip_lines l WHERE l.slip_id = s.id) AS line_count
     FROM slips s
     LEFT JOIN shippers sh ON sh.id = s.shipper_id
     ${where}
     ORDER BY array_position(ARRAY['unprocessed','hold','confirmed','done'], s.status),
              s.received_at DESC`,
    status ? { status } : {}
  );
}

export interface SlipLineDetail extends SlipLine {
  item_name: string | null;
  item_spec: string | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
}

export interface SlipDetail {
  slip: Slip;
  shipper: Shipper | null;
  lines: SlipLineDetail[];
}

export async function getSlipDetail(id: number): Promise<SlipDetail | null> {
  const slips = await db().rows<Slip>("SELECT * FROM slips WHERE id = :id", { id });
  if (slips.length === 0) return null;
  const slip = slips[0];

  let shipper: Shipper | null = null;
  if (slip.shipper_id) {
    const shippers = await db().rows<Shipper>(
      "SELECT * FROM shippers WHERE id = :id",
      { id: slip.shipper_id }
    );
    shipper = shippers[0] ?? null;
  }

  const lines = await db().rows<SlipLineDetail>(
    `SELECT l.*, i.name AS item_name, i.spec AS item_spec,
            w.code AS warehouse_code, w.name AS warehouse_name
     FROM slip_lines l
     LEFT JOIN items i ON i.id = l.item_id
     LEFT JOIN warehouses w ON w.id = l.warehouse_id
     WHERE l.slip_id = :id
     ORDER BY l.line_no`,
    { id }
  );
  return { slip, shipper, lines };
}

/** 荷主確定フォーム用：全荷主 */
export async function listShippers(): Promise<Shipper[]> {
  return db().rows<Shipper>("SELECT * FROM shippers ORDER BY name");
}

export interface ItemOption {
  id: number;
  name: string;
  spec: string;
}

/** 保留解消フォーム用：同一荷主の品目一覧 */
export async function listItemsByShipper(shipperId: number): Promise<ItemOption[]> {
  return db().rows<ItemOption>(
    "SELECT id, name, spec FROM items WHERE shipper_id = :shipperId ORDER BY name, spec",
    { shipperId }
  );
}

export interface HistoryRow {
  id: number;
  target_type: string;
  target_id: number;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string;
  operator: string;
  created_at: string;
  line_no: number | null; // slip_line の場合の行番号
}

/** 伝票詳細の修正履歴：伝票本体と明細の edit_logs を時系列で返す */
export async function getSlipHistory(slipId: number): Promise<HistoryRow[]> {
  return db().rows<HistoryRow>(
    `SELECT e.*, l.line_no
     FROM edit_logs e
     LEFT JOIN slip_lines l ON e.target_type = 'slip_line' AND l.id = e.target_id
     WHERE (e.target_type = 'slip' AND e.target_id = :slipId)
        OR (e.target_type = 'slip_line' AND e.target_id IN
            (SELECT id FROM slip_lines WHERE slip_id = :slipId))
     ORDER BY e.id`,
    { slipId }
  );
}

export async function listWarehouses(): Promise<Warehouse[]> {
  return db().rows<Warehouse>("SELECT * FROM warehouses ORDER BY code");
}

export interface StockListRow {
  stock_id: number;
  version: number;
  quantity: number;
  production_date: string | null;
  lot_no: string;
  order_no: string;
  item_id: number;
  item_name: string;
  spec: string;
  shipper_id: number;
  shipper_name: string;
  production_date_managed: boolean;
  warehouse_code: string;
  warehouse_name: string;
}

export interface SummaryRow {
  slip_id: number;
  slip_type: SlipType;
  slip_number: string;
  confirmed_by: string;
  confirmed_at: string;
  movement_date: string | null;
  shipper_name: string | null;
  line_no: number;
  item_name: string | null;
  item_name_raw: string;
  spec: string | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
  production_date: string | null;
  lot_no: string;
  quantity: number;
}

/**
 * 入出庫サマリー：指定日の入出庫の明細一覧（企画書 6.6 最後の砦）。
 * 基準日は入出庫日（書類上の出荷日/入荷日）。読取・確定が遅れても実際の日に載る（FB⑥）。
 * 入出庫日が未設定の旧伝票は確定日で拾う。
 */
export async function getDailySummary(date: string): Promise<SummaryRow[]> {
  return db().rows<SummaryRow>(
    `SELECT s.id AS slip_id, s.slip_type, s.slip_number, s.confirmed_by, s.confirmed_at,
            s.movement_date,
            sh.name AS shipper_name,
            l.line_no, i.name AS item_name, l.item_name_raw, i.spec,
            w.code AS warehouse_code, w.name AS warehouse_name,
            l.production_date, l.lot_no, l.quantity
     FROM slips s
     JOIN slip_lines l ON l.slip_id = s.id
     LEFT JOIN shippers sh ON sh.id = s.shipper_id
     LEFT JOIN items i ON i.id = l.item_id
     LEFT JOIN warehouses w ON w.id = l.warehouse_id
     WHERE s.status = 'done' AND COALESCE(s.movement_date, s.confirmed_at::date) = :date
     ORDER BY s.slip_type, s.confirmed_at, s.id, l.line_no`,
    { date }
  );
}

/** 在庫一覧：荷主 → 品目 → 製造日/ロットの順で返す（企画書 6.6 在庫報告の並び）。倉庫で絞り込み可 */
export async function listStock(warehouseId?: number): Promise<StockListRow[]> {
  const where = warehouseId ? "WHERE st.warehouse_id = :warehouseId" : "";
  return db().rows<StockListRow>(
    `SELECT st.id AS stock_id, st.version, st.quantity, st.production_date, st.lot_no, st.order_no,
            i.id AS item_id, i.name AS item_name, i.spec,
            sh.id AS shipper_id, sh.name AS shipper_name, sh.production_date_managed,
            w.code AS warehouse_code, w.name AS warehouse_name
     FROM stock st
     JOIN items i ON i.id = st.item_id
     JOIN shippers sh ON sh.id = i.shipper_id
     JOIN warehouses w ON w.id = st.warehouse_id
     ${where}
     ORDER BY sh.name, i.name, i.spec, st.production_date IS NULL, st.production_date, st.lot_no`,
    warehouseId ? { warehouseId } : {}
  );
}
