import type { Queryable } from "./db";
import { withTransaction } from "./db";
import { loadRuleByShipperId } from "./rules";
import type { Slip, SlipLine, StockRow } from "./types";

// 確定→在庫反映（企画書 6.2/6.3/6.4）
// - 確定は入力担当の操作。ここは「確定ボタンが押された後」の反映のみを行う
// - マイナス在庫は確定を止めて警告を返し、担当の明示承認（allowNegative）でのみ通す
// - 楽観的ロック：確定時に version が画面表示時と一致しなければ競合エラー

export interface NegativeWarning {
  lineNo: number;
  itemName: string;
  requested: number;
  available: number;
}

export type ConfirmResult =
  | { ok: true }
  | { ok: false; kind: "conflict" | "invalid"; message: string }
  | { ok: false; kind: "negative"; warnings: NegativeWarning[] }
  | { ok: false; kind: "date_mismatch"; message: string };

interface LineForConfirm extends SlipLine {
  item_name: string | null;
}

async function logEdit(
  conn: Queryable,
  entry: {
    targetType: "stock" | "slip" | "slip_line";
    targetId: number;
    action: "create" | "update" | "confirm" | "hold" | "release" | "adjust";
    field?: string;
    oldValue?: string;
    newValue?: string;
    reason: string;
    operator: string;
  }
) {
  const params = {
    field: null,
    oldValue: null,
    newValue: null,
    ...entry,
  };
  await conn.exec(
    `INSERT INTO edit_logs (target_type, target_id, action, field, old_value, new_value, reason, operator)
     VALUES (:targetType, :targetId, :action, :field, :oldValue, :newValue, :reason, :operator)`,
    params
  );
}

/** 在庫行へ加算（入庫）。同一キーが無ければ新規作成。対象在庫行のIDを返す。 */
async function addStock(
  conn: Queryable,
  params: {
    warehouseId: number;
    itemId: number;
    productionDate: string | null;
    lotNo: string;
    orderNo: string;
    quantity: number;
  }
): Promise<number> {
  // MySQL の ON DUPLICATE KEY UPDATE + LAST_INSERT_ID トリックは
  // ON CONFLICT ... DO UPDATE + RETURNING id で置換
  const rows = await conn.rows<{ id: number }>(
    `INSERT INTO stock (warehouse_id, item_id, production_date, lot_no, order_no, quantity)
     VALUES (:warehouseId, :itemId, :productionDate, :lotNo, :orderNo, :quantity)
     ON CONFLICT (warehouse_id, item_id, production_date_key, lot_no, order_no)
     DO UPDATE SET
       quantity = stock.quantity + EXCLUDED.quantity,
       version = stock.version + 1
     RETURNING id`,
    params
  );
  return rows[0].id;
}

/** 対象在庫行を古い順にロックして取得（FIFO引き当て用） */
async function selectStockForUpdate(
  conn: Queryable,
  warehouseId: number,
  itemId: number
): Promise<StockRow[]> {
  return conn.rows<StockRow>(
    `SELECT * FROM stock
     WHERE warehouse_id = :warehouseId AND item_id = :itemId
     ORDER BY production_date_key, lot_no, order_no
     FOR UPDATE`,
    { warehouseId, itemId }
  );
}

/** 出庫の引き当て計画：どの在庫行から何個引くか（この時点ではまだ書き込まない） */
interface Deduction {
  stockId: number | null; // null = 在庫行が存在しない（承認時に新規マイナス行を作る）
  key: {
    warehouseId: number;
    itemId: number;
    productionDate: string | null;
    lotNo: string;
    orderNo: string;
  };
  quantity: number;
  oldQuantity: number;
}

export async function confirmSlip(input: {
  slipId: number;
  operator: string;
  expectedVersion: number;
  allowNegative: boolean;
  /** 入出庫日が本日でない伝票の確定を担当が明示承認した場合 true（FB⑥） */
  allowDateMismatch?: boolean;
}): Promise<ConfirmResult> {
  const { slipId, operator, expectedVersion, allowNegative, allowDateMismatch = false } = input;
  return withTransaction(async (conn): Promise<ConfirmResult> => {
    const slips = await conn.rows<Slip>(
      "SELECT * FROM slips WHERE id = :slipId FOR UPDATE",
      { slipId }
    );
    const slip = slips[0];
    if (!slip) return { ok: false, kind: "invalid", message: "伝票が見つかりません。" };
    if (slip.status !== "unprocessed") {
      return {
        ok: false,
        kind: "invalid",
        message: `この伝票は「${slip.status}」のため確定できません。保留中の場合は先に保留解除してください。`,
      };
    }
    if (slip.version !== expectedVersion) {
      return {
        ok: false,
        kind: "conflict",
        message: "他の担当者がこの伝票を更新しました。最新の内容を確認してから再度確定してください。",
      };
    }
    if (!slip.shipper_id) {
      return { ok: false, kind: "invalid", message: "荷主が未確定です。先に荷主を紐付けてください。" };
    }

    // 入出庫日の関門（FB⑥）：本日でない伝票は担当の明示承認でのみ確定する。
    // 記録・サマリーは入出庫日基準（読取が遅れても実際の入出庫日で残る）
    if (!allowDateMismatch && slip.movement_date) {
      const todayRows = await conn.rows<{ today: string }>(
        "SELECT jst_now()::date::text AS today"
      );
      const today = todayRows[0].today;
      if (slip.movement_date !== today) {
        const isPast = slip.movement_date < today;
        return {
          ok: false,
          kind: "date_mismatch",
          message: isPast
            ? `この伝票の入出庫日は ${slip.movement_date}（本日より前）です。確定の操作は本日ですが、記録・サマリーは ${slip.movement_date} の入出庫として処理します。よろしいですか？`
            : `この伝票の入出庫日は ${slip.movement_date}（先日付）です。このまま確定すると在庫は本日時点で反映されます（サマリーには ${slip.movement_date} の入出庫として載ります）。当日に確定し直すこともできます。よろしいですか？`,
        };
      }
    }

    const rule = await loadRuleByShipperId(conn, slip.shipper_id);
    if (!rule) {
      return {
        ok: false,
        kind: "invalid",
        message: "荷主マスタが見つかりません。荷主マスタの登録を確認してください。",
      };
    }

    const lines = await conn.rows<LineForConfirm>(
      `SELECT l.*, i.name AS item_name FROM slip_lines l
       LEFT JOIN items i ON i.id = l.item_id
       WHERE l.slip_id = :slipId ORDER BY l.line_no`,
      { slipId }
    );
    if (lines.length === 0) {
      return { ok: false, kind: "invalid", message: "明細がありません。" };
    }
    for (const line of lines) {
      if (line.line_status === "hold") {
        return {
          ok: false,
          kind: "invalid",
          message: `明細 ${line.line_no} が保留中です（${line.hold_reason ?? "理由未記載"}）。解消してから確定してください。`,
        };
      }
      if (!line.item_id || !line.warehouse_id) {
        return {
          ok: false,
          kind: "invalid",
          message: `明細 ${line.line_no} の品目または倉庫が未確定です。`,
        };
      }
      if (!(line.quantity > 0)) {
        return { ok: false, kind: "invalid", message: `明細 ${line.line_no} の数量が不正です。` };
      }
    }

    // 製造日管理なしの荷主は在庫キーから製造日を落とす（荷主マスタ準拠）
    const effDate = (d: string | null) => (rule.productionDateManaged ? d : null);

    if (slip.slip_type === "inbound") {
      for (const line of lines) {
        const stockId = await addStock(conn, {
          warehouseId: line.warehouse_id!,
          itemId: line.item_id!,
          productionDate: effDate(line.production_date),
          lotNo: line.lot_no,
          orderNo: line.order_no,
          quantity: line.quantity,
        });
        await logEdit(conn, {
          targetType: "stock",
          targetId: stockId,
          action: "update",
          field: "quantity",
          newValue: `+${line.quantity}`,
          reason: `伝票 #${slipId}（入庫）確定による反映`,
          operator,
        });
      }
    } else {
      // 出庫：まず全明細の引き当て計画を立て、マイナスが出るなら書き込む前に止める
      const deductions: Deduction[] = [];
      const warnings: NegativeWarning[] = [];

      for (const line of lines) {
        const stockRows = await selectStockForUpdate(conn, line.warehouse_id!, line.item_id!);
        const lotSpecified =
          rule.allocationRule === "lot_specified" ||
          line.production_date !== null ||
          line.lot_no !== "";

        let candidates: StockRow[];
        if (lotSpecified) {
          candidates = stockRows.filter(
            (s) =>
              s.production_date === effDate(line.production_date) &&
              s.lot_no === line.lot_no
          );
          if (rule.allocationRule === "lot_specified" && candidates.length === 0) {
            // 指定ロット不存在はFIFOへ自動振替しない（荷主マスタ準拠）→ 確定不可
            return {
              ok: false,
              kind: "invalid",
              message: `明細 ${line.line_no}: 指定ロット（製造日 ${line.production_date ?? "―"} / ロット ${line.lot_no || "―"}）の在庫が存在しません。保留にして荷主へ確認してください。`,
            };
          }
        } else {
          candidates = stockRows; // FIFO: 古い製造日から
        }

        let remaining = line.quantity;
        const available = candidates.reduce((sum, s) => sum + Number(s.quantity), 0);
        if (available < line.quantity) {
          warnings.push({
            lineNo: line.line_no,
            itemName: line.item_name ?? line.item_name_raw,
            requested: line.quantity,
            available,
          });
        }

        for (const s of candidates) {
          if (remaining <= 0) break;
          const take = Math.min(Number(s.quantity), remaining);
          if (take > 0) {
            deductions.push({
              stockId: s.id,
              key: {
                warehouseId: s.warehouse_id,
                itemId: s.item_id,
                productionDate: s.production_date,
                lotNo: s.lot_no,
                orderNo: s.order_no,
              },
              quantity: take,
              oldQuantity: Number(s.quantity),
            });
            remaining -= take;
          }
        }
        if (remaining > 0) {
          // 在庫が足りない分：最後の候補行をマイナスに落とす（行が無ければ新規マイナス行）
          const last = candidates[candidates.length - 1];
          const existing = last
            ? deductions.find((d) => d.stockId === last.id)
            : undefined;
          if (existing) {
            // 同一在庫行への引き当てはまとめる（履歴を1行=1事実に保つ）
            existing.quantity += remaining;
          } else {
            deductions.push({
              stockId: last?.id ?? null,
              key: {
                warehouseId: line.warehouse_id!,
                itemId: line.item_id!,
                productionDate: last?.production_date ?? effDate(line.production_date),
                lotNo: last?.lot_no ?? line.lot_no,
                orderNo: last?.order_no ?? line.order_no,
              },
              quantity: remaining,
              oldQuantity: last ? Number(last.quantity) : 0,
            });
          }
        }
      }

      if (warnings.length > 0 && !allowNegative) {
        // 何も書き込まずに返す（トランザクションは空コミット）
        return { ok: false, kind: "negative", warnings };
      }

      for (const d of deductions) {
        let stockId = d.stockId;
        if (stockId !== null) {
          await conn.exec(
            `UPDATE stock SET quantity = quantity - :qty, version = version + 1 WHERE id = :id`,
            { qty: d.quantity, id: stockId }
          );
        } else {
          stockId = await addStock(conn, {
            warehouseId: d.key.warehouseId,
            itemId: d.key.itemId,
            productionDate: d.key.productionDate,
            lotNo: d.key.lotNo,
            orderNo: d.key.orderNo,
            quantity: -d.quantity,
          });
        }
        await logEdit(conn, {
          targetType: "stock",
          targetId: stockId,
          action: "update",
          field: "quantity",
          oldValue: String(d.oldQuantity),
          newValue: String(d.oldQuantity - d.quantity),
          reason:
            `伝票 #${slipId}（出庫）確定による反映` +
            (allowNegative && warnings.length > 0 ? "（マイナス在庫を担当承認済み）" : ""),
          operator,
        });
      }
    }

    await conn.exec(
      `UPDATE slips SET status = 'done', confirmed_by = :operator, confirmed_at = jst_now(),
              version = version + 1, editing_by = NULL, editing_at = NULL
       WHERE id = :slipId`,
      { operator, slipId }
    );
    await logEdit(conn, {
      targetType: "slip",
      targetId: slipId,
      action: "confirm",
      reason: `確認フォームで内容を確認のうえ確定（入出庫日 ${slip.movement_date ?? "―"}・在庫責任は確定者に帰属）`,
      operator,
    });
    return { ok: true };
  });
}
