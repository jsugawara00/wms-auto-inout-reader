import { withTransaction } from "./db";
import { normalizeItemName } from "./normalize";
import type { Slip, SlipLine } from "./types";

// 保留明細の解消（企画書 6.4）
// 「既存の◯◯ですか／新規品目ですか」の判断は担当が行い、選択の内容を履歴に残す。

export type ResolveChoice =
  | { type: "existing"; itemId: number }
  | {
      type: "new";
      /** 登録する品名・規格（省略時は読取値のまま）。FAXの品名欄に規格が
          併記されている等、読取値を直して登録したい場合に指定する（FB④） */
      name?: string;
      spec?: string;
    };

export type ResolveResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function resolveLine(input: {
  slipId: number;
  lineId: number;
  expectedVersion: number;
  operator: string;
  choice: ResolveChoice;
  note?: string;
}): Promise<ResolveResult> {
  const { slipId, lineId, expectedVersion, operator, choice, note } = input;

  return withTransaction(async (conn): Promise<ResolveResult> => {
    const slips = await conn.rows<Slip>(
      "SELECT * FROM slips WHERE id = :slipId FOR UPDATE",
      { slipId }
    );
    const slip = slips[0];
    if (!slip) return { ok: false, message: "伝票が見つかりません。" };
    if (slip.status === "done") {
      return { ok: false, message: "確定済みの伝票の明細は解消できません。" };
    }
    if (slip.version !== expectedVersion) {
      return {
        ok: false,
        message: "他の担当者がこの伝票を更新しました。最新表示を確認してください。",
      };
    }
    if (!slip.shipper_id) {
      return { ok: false, message: "荷主が未確定のため品目を確定できません。" };
    }

    const lineRows = await conn.rows<SlipLine>(
      "SELECT * FROM slip_lines WHERE id = :lineId AND slip_id = :slipId",
      { lineId, slipId }
    );
    const line = lineRows[0];
    if (!line) return { ok: false, message: "明細が見つかりません。" };
    if (line.line_status !== "hold") {
      return { ok: false, message: "この明細は保留中ではありません。" };
    }

    let itemId: number;
    let reason: string;

    if (choice.type === "existing") {
      const items = await conn.rows<{ id: number; name: string; spec: string }>(
        "SELECT id, name, spec FROM items WHERE id = :itemId AND shipper_id = :shipperId",
        { itemId: choice.itemId, shipperId: slip.shipper_id }
      );
      const item = items[0];
      if (!item) {
        return { ok: false, message: "選択された品目がこの荷主に存在しません。" };
      }
      itemId = item.id;
      reason = `保留解消：既存品目「${item.name} ${item.spec || "規格なし"}」へ寄せる（読取: ${line.item_name_raw} ${line.spec_raw || "規格なし"}）`;
    } else {
      // 新規品目として登録（担当の明示判断による。取込時は自動登録しない）
      // 登録名は担当が修正できる（読取値と異なる場合は履歴に両方残す：FB④）
      const name = choice.name?.trim() || line.item_name_raw;
      const spec = choice.spec?.trim() ?? line.spec_raw;
      const dup = await conn.rows<{ id: number }>(
        `SELECT id FROM items WHERE shipper_id = :shipperId AND name = :name AND spec = :spec`,
        { shipperId: slip.shipper_id, name, spec }
      );
      if (dup.length > 0) {
        return {
          ok: false,
          message: `同じ品名・規格の品目が既に存在します。「既存：${name} ${spec || "規格なし"}」を選択してください。`,
        };
      }
      const ins = await conn.rows<{ id: number }>(
        `INSERT INTO items (shipper_id, name, spec, name_normalized)
         VALUES (:shipperId, :name, :spec, :nameNormalized)
         RETURNING id`,
        {
          shipperId: slip.shipper_id,
          name,
          spec,
          nameNormalized: normalizeItemName(name),
        }
      );
      itemId = ins[0].id;
      const edited = name !== line.item_name_raw || spec !== line.spec_raw;
      reason = edited
        ? `保留解消：新規品目「${name} ${spec || "規格なし"}」として登録（読取「${line.item_name_raw} ${line.spec_raw || "規格なし"}」から担当が修正）`
        : `保留解消：新規品目「${name} ${spec || "規格なし"}」として登録`;
      await conn.exec(
        `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
         VALUES ('item', :itemId, 'create', :reason, :operator)`,
        { itemId, reason, operator }
      );
    }

    if (note) reason += `／補足: ${note}`;

    await conn.exec(
      `UPDATE slip_lines SET item_id = :itemId, line_status = 'ok', hold_reason = NULL
       WHERE id = :lineId`,
      { itemId, lineId }
    );
    await conn.exec("UPDATE slips SET version = version + 1 WHERE id = :slipId", {
      slipId,
    });
    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, field, old_value, new_value, reason, operator)
       VALUES ('slip_line', :lineId, 'release', 'item_id', :oldValue, :newValue, :reason, :operator)`,
      {
        lineId,
        oldValue: line.item_id === null ? "" : String(line.item_id),
        newValue: String(itemId),
        reason,
        operator,
      }
    );
    return { ok: true, message: reason };
  });
}
