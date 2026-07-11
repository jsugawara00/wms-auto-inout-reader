// DB行に対応するドメイン型（db/schema.sql と対で保守する）

export type SlipType = "inbound" | "outbound";
export type SourceType = "fax" | "mail";
export type SlipStatus = "unprocessed" | "confirmed" | "done" | "hold";
export type LineStatus = "ok" | "hold";
export type Confidence = "high" | "medium" | "low";
export type AllocationRule = "fifo" | "lot_specified";

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  warehouse_type: "normal" | "chilled" | "frozen";
}

export interface Shipper {
  id: number;
  name: string;
  name_normalized: string;
  /** 別名（読取名等）。JSONB列（pgはオブジェクトで返す） */
  aliases: string[];
  /** 引き当てルール（旧 rules/*.md を廃止しDBが正） */
  allocation_rule: AllocationRule;
  production_date_managed: boolean;
  /** 特殊例外（自由記述）。確認フォームに表示するのみで自動適用しない */
  exceptions_note: string;
  section: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
}

export interface Item {
  id: number;
  shipper_id: number;
  name: string;
  spec: string;
  name_normalized: string;
  /** 商品コード（商品マスタ管理画面で保守） */
  item_code: string;
  /** 単価（請求フェーズで使用。未設定は null） */
  unit_price: number | null;
  status: "active" | "hold";
}

export interface StockRow {
  id: number;
  warehouse_id: number;
  item_id: number;
  production_date: string | null; // 'YYYY-MM-DD'
  lot_no: string;
  order_no: string;
  quantity: number;
  version: number;
}

export interface Slip {
  id: number;
  slip_type: SlipType;
  source_type: SourceType;
  slip_number: string;
  fingerprint: string;
  status: SlipStatus;
  shipper_id: number | null;
  requested_at: string | null;
  received_at: string;
  source_file: string | null;
  confidence: Confidence | null;
  note: string | null;
  hold_reason: string | null;
  assigned_to: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  version: number;
  editing_by: string | null;
  editing_at: string | null;
  /** Claude読取の生結果（監査用）。pgはJSONB列をオブジェクトで返す */
  extracted_json?: unknown;
}

export interface SlipLine {
  id: number;
  slip_id: number;
  line_no: number;
  item_name_raw: string;
  spec_raw: string;
  /** 読取そのままの商品コード（照合ヒント・監査用） */
  item_code_raw: string;
  item_id: number | null;
  warehouse_id: number | null;
  production_date: string | null;
  lot_no: string;
  order_no: string;
  quantity: number;
  site_reported_quantity: number | null;
  line_status: LineStatus;
  hold_reason: string | null;
}

/** 荷主の引き当てルール（shippers テーブルの列が正。エンジンはこれを読んで従う） */
export interface ShipperRule {
  shipperId: number;
  shipperName: string;
  aliases: string[];
  allocationRule: AllocationRule;
  productionDateManaged: boolean;
  /** 特殊例外（自由記述）。確認フォームに表示するのみで自動適用しない */
  exceptionsBody: string;
}
