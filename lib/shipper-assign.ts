import { withTransaction } from "./db";
import { normalizeShipperName } from "./normalize";
import { matchItemForLine } from "./item-match";
import type { Slip, SlipLine, AllocationRule } from "./types";

// 荷主の確定（企画書 6.5：初回入庫時に一度だけ確定し、以降は再利用）
// - 既存荷主へ紐付け or 新規荷主として登録（引き当てルールは shippers テーブルが正）
// - 確定後、全明細の品目照合を自動で再実行する
// - 権限分岐（admin=その場確定／operator=保留＋登録依頼）は呼び出し側（画面・アクション）で行う

export type AssignChoice =
  | { type: "existing"; shipperId: number }
  | {
      type: "new";
      officialName: string;
      allocationRule: AllocationRule;
      productionDateManaged: boolean;
      section?: string;
      /** 特殊例外（自由記述）。確認フォームに表示するのみで自動適用しない */
      exceptionsNote?: string;
    };

export type AssignResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function assignShipper(input: {
  slipId: number;
  expectedVersion: number;
  operator: string;
  choice: AssignChoice;
  /** 読取された荷主名（新規登録時に alias として保存） */
  rawShipperName?: string;
}): Promise<AssignResult> {
  const { slipId, expectedVersion, operator, choice, rawShipperName } = input;

  if (choice.type === "new" && !choice.officialName.trim()) {
    return { ok: false, message: "正式名称を入力してください。" };
  }

  return withTransaction(async (conn): Promise<AssignResult> => {
    const slips = await conn.rows<Slip>(
      "SELECT * FROM slips WHERE id = :slipId FOR UPDATE",
      { slipId }
    );
    const slip = slips[0];
    if (!slip) return { ok: false, message: "伝票が見つかりません。" };
    if (slip.status !== "unprocessed") {
      return { ok: false, message: `「${slip.status}」の伝票の荷主は変更できません。` };
    }
    if (slip.version !== expectedVersion) {
      return { ok: false, message: "他の担当者がこの伝票を更新しました。最新表示を確認してください。" };
    }
    if (slip.shipper_id) {
      return { ok: false, message: "この伝票は既に荷主が確定しています。" };
    }

    let shipperId: number;
    let shipperName: string;

    if (choice.type === "existing") {
      const rows = await conn.rows<{ id: number; name: string }>(
        "SELECT id, name FROM shippers WHERE id = :id",
        { id: choice.shipperId }
      );
      const shipper = rows[0];
      if (!shipper) return { ok: false, message: "選択された荷主が存在しません。" };
      shipperId = shipper.id;
      shipperName = shipper.name;
    } else {
      const officialName = choice.officialName.trim();
      const key = normalizeShipperName(officialName);
      const dup = await conn.rows<{ id: number; name: string }>(
        "SELECT id, name FROM shippers WHERE name_normalized = :key",
        { key }
      );
      if (dup.length > 0) {
        return {
          ok: false,
          message: `同一とみられる荷主「${dup[0].name}」が既に登録されています。既存から選択してください。`,
        };
      }
      // 読取名が正式名称と異なる場合は alias として保存（表記ゆれ照合に使う）
      const aliases: string[] = [];
      if (
        rawShipperName &&
        normalizeShipperName(rawShipperName) !== key
      ) {
        aliases.push(rawShipperName);
      }
      const ins = await conn.rows<{ id: number }>(
        `INSERT INTO shippers
           (name, name_normalized, aliases, allocation_rule, production_date_managed,
            exceptions_note, section)
         VALUES (:name, :key, :aliases, :allocationRule, :productionDateManaged,
                 :exceptionsNote, :section)
         RETURNING id`,
        {
          name: officialName,
          key,
          aliases: JSON.stringify(aliases),
          allocationRule: choice.allocationRule,
          productionDateManaged: choice.productionDateManaged,
          exceptionsNote: choice.exceptionsNote ?? "",
          section: choice.section ?? null,
        }
      );
      shipperId = ins[0].id;
      shipperName = officialName;
      await conn.exec(
        `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
         VALUES ('shipper', :id, 'create', :reason, :operator)`,
        {
          id: shipperId,
          reason: `荷主確定フォームから新規登録（引き当てルール: ${choice.allocationRule} / 製造日管理: ${choice.productionDateManaged ? "あり" : "なし"}）`,
          operator,
        }
      );
    }

    await conn.exec(
      "UPDATE slips SET shipper_id = :shipperId, version = version + 1 WHERE id = :slipId",
      { shipperId, slipId }
    );

    // 品目照合を再実行（荷主未確定で保留になっていた明細を解きにいく）
    const lineRows = await conn.rows<SlipLine>(
      "SELECT * FROM slip_lines WHERE slip_id = :slipId AND item_id IS NULL",
      { slipId }
    );
    let matched = 0;
    let held = 0;
    for (const raw of lineRows) {
      const match = await matchItemForLine(conn, shipperId, {
        itemNameRaw: raw.item_name_raw,
        specRaw: raw.spec_raw,
        lotNo: raw.lot_no,
        itemCodeRaw: raw.item_code_raw,
      });
      await conn.exec(
        `UPDATE slip_lines SET item_id = :itemId, line_status = :lineStatus, hold_reason = :holdReason
         WHERE id = :lineId`,
        { itemId: match.itemId, lineStatus: match.lineStatus, holdReason: match.holdReason, lineId: raw.id }
      );
      if (match.itemId) matched++;
      else held++;
    }

    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, field, old_value, new_value, reason, operator)
       VALUES ('slip', :slipId, 'update', 'shipper_id', '', :newValue, :reason, :operator)`,
      {
        slipId,
        newValue: String(shipperId),
        reason:
          choice.type === "existing"
            ? `荷主を「${shipperName}」に確定（読取: ${rawShipperName ?? "―"}）。品目照合を再実行（自動紐付け ${matched} 件・保留 ${held} 件）`
            : `新規荷主「${shipperName}」を登録して確定（読取: ${rawShipperName ?? "―"}）。品目照合を再実行（自動紐付け ${matched} 件・保留 ${held} 件）`,
        operator,
      }
    );
    return {
      ok: true,
      message: `荷主を「${shipperName}」に確定しました（品目の自動紐付け ${matched} 件・保留 ${held} 件）。`,
    };
  });
}
