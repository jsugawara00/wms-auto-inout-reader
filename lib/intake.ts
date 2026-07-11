import crypto from "node:crypto";
import { withTransaction, db } from "./db";
import { extractSlipFromPdf, type Extraction } from "./extract";
import { findRuleByName } from "./rules";
import { normalizeShipperName, normalizeItemName, normalizeSpec } from "./normalize";
import { matchItemForLine } from "./item-match";
import { storePdf } from "./blob";
import { notifySlack } from "./notify";

// PDF取込：画面アップロード／メール添付 → Claude読取 → 伝票起票（企画書 6.1/6.4/6.5）
// 試作のフォルダ監視は廃止し、アップロード即時処理＋メール定期取込（Vercel Cron）へ。
// - 二重読込防止：指紋 = SHA-256(伝票番号 + 正規化明細)
// - 荷主：shippers テーブルが正（表記ゆれ・エイリアス照合は lib/rules.ts）
// - 品名ゆれ：完全一致のみ自動紐付け。似ている・不明は保留（黙って新規登録しない）
// - 無関係な文書も黙って捨てず intake_logs に記録し通知する
// - PDF原本は Vercel Blob に保管し source_file に URL を残す（監査用）

export interface IntakeResult {
  file: string;
  result: "slip_created" | "irrelevant" | "duplicate" | "error";
  slipId?: number;
  message: string;
  /** 起票時のみ：保留行の数と読取確信度（Slackの要確認判定に使用） */
  holdCount?: number;
  confidence?: "high" | "medium" | "low";
  shipperName?: string | null;
  slipTypeLabel?: string;
}

/** 指紋：伝票番号＋正規化した明細（品名・規格・数量・製造日・ロット）から生成 */
export function buildFingerprint(ex: Extraction): string {
  const lines = ex.lines
    .map(
      (l) =>
        `${normalizeItemName(l.item_name)}|${normalizeSpec(l.spec)}|${l.quantity}|${l.production_date ?? ""}|${l.lot_no}|${l.order_no}`
    )
    .sort()
    .join("\n");
  return crypto
    .createHash("sha256")
    .update(`${ex.slip_number}\n${normalizeShipperName(ex.shipper_name)}\n${ex.slip_type}\n${lines}`)
    .digest("hex");
}

function parseDateTime(s: string | null): string | null {
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s) ? s : null;
}

function parseDateOnly(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

async function logIntake(entry: {
  sourceType: "fax" | "mail";
  sourceRef: string;
  result: IntakeResult["result"];
  slipId?: number | null;
  note?: string | null;
}): Promise<void> {
  const params = { slipId: null, note: null, ...entry };
  await db().exec(
    `INSERT INTO intake_logs (source_type, source_ref, result, slip_id, note)
     VALUES (:sourceType, :sourceRef, :result, :slipId, :note)`,
    params
  );
}

interface CreatedSlip {
  slipId: number;
  holdCount: number;
  shipperName: string | null;
}

/** 抽出結果1件を伝票として起票する */
async function createSlip(
  ex: Extraction,
  sourceFile: string,
  sourceType: "fax" | "mail"
): Promise<CreatedSlip> {
  const rule = await findRuleByName(ex.shipper_name);

  return withTransaction(async (conn) => {
    // 荷主の解決：shippers テーブルが正。照合できなければ未確定（荷主確定フォームへ）
    const shipperId: number | null = rule?.shipperId ?? null;

    const unitNotes = ex.lines
      .filter((l) => l.unit_note)
      .map((l) => `行${ex.lines.indexOf(l) + 1}: ${l.unit_note}`)
      .join(" / ");
    const note = [ex.note, unitNotes].filter(Boolean).join(" / ") || null;

    // 入出庫日：書類上の出荷日/入荷日 → 無ければ依頼日 → それも無ければ取込日（本日）
    const movementDate =
      parseDateOnly(ex.movement_date) ?? parseDateOnly(ex.requested_at);

    const slipIns = await conn.rows<{ id: number }>(
      `INSERT INTO slips (slip_type, source_type, slip_number, fingerprint, status,
                          shipper_id, requested_at, movement_date, received_at, source_file,
                          extracted_json, confidence, note)
       VALUES (:slipType, :sourceType, :slipNumber, :fingerprint, 'unprocessed',
               :shipperId, :requestedAt, COALESCE(:movementDate::date, jst_now()::date),
               jst_now(), :sourceFile, :extractedJson, :confidence, :note)
       RETURNING id`,
      {
        slipType: ex.slip_type,
        sourceType,
        slipNumber: ex.slip_number,
        fingerprint: buildFingerprint(ex),
        shipperId,
        requestedAt: parseDateTime(ex.requested_at),
        movementDate,
        sourceFile: sourceFile,
        extractedJson: JSON.stringify(ex), // 監査用に生結果を保持
        confidence: ex.confidence,
        note,
      }
    );
    const slipId = slipIns[0].id;
    let holdCount = 0;

    for (let i = 0; i < ex.lines.length; i++) {
      const line = ex.lines[i];

      // 品目照合（完全一致のみ自動紐付け・ロットヒント付き）：lib/item-match.ts に共通化
      const match = shipperId
        ? await matchItemForLine(conn, shipperId, {
            itemNameRaw: line.item_name,
            specRaw: line.spec,
            lotNo: line.lot_no,
            itemCodeRaw: line.item_code,
          })
        : {
            itemId: null,
            lineStatus: "hold" as const,
            holdReason:
              "荷主が未確定のため品目照合ができません。先に荷主を確定してください。",
          };
      const { itemId, lineStatus, holdReason } = match;

      await conn.exec(
        `INSERT INTO slip_lines (slip_id, line_no, item_name_raw, spec_raw, item_code_raw, item_id,
                                 warehouse_id, production_date, lot_no, order_no,
                                 quantity, line_status, hold_reason)
         VALUES (:slipId, :lineNo, :itemNameRaw, :specRaw, :itemCodeRaw, :itemId,
                 NULL, :productionDate, :lotNo, :orderNo, :quantity, :lineStatus, :holdReason)`,
        {
          slipId,
          lineNo: i + 1,
          itemNameRaw: line.item_name,
          specRaw: line.spec,
          itemCodeRaw: line.item_code,
          itemId,
          productionDate: parseDateTime(line.production_date),
          lotNo: line.lot_no,
          orderNo: line.order_no,
          quantity: line.quantity,
          lineStatus,
          holdReason,
        }
      );
      if (lineStatus === "hold") holdCount++;
    }

    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
       VALUES ('slip', :slipId, 'create', 'PDF取込により起票（確定は入力担当の操作）', 'system:intake')`,
      { slipId }
    );
    return { slipId, holdCount, shipperName: rule?.shipperName ?? null };
  });
}

/**
 * 抽出結果1件を受け止める共通処理（PDF由来・メール本文由来で共用）。
 * 無関係判定 → 指紋による二重読込防止 → 起票 → intake_logs 記録。
 */
export async function intakeExtraction(
  ex: Extraction,
  sourceRef: string,
  sourceType: "fax" | "mail"
): Promise<IntakeResult> {
  if (!ex.is_relevant || !ex.slip_type) {
    await logIntake({
      sourceType,
      sourceRef,
      result: "irrelevant",
      note: ex.note ?? "入出庫依頼ではない文書",
    });
    return {
      file: sourceRef,
      result: "irrelevant",
      message: `入出庫と無関係な文書です（${ex.note ?? "種類不明"}）。担当者の確認をお願いします。`,
    };
  }

  // 二重読込防止（企画書 6.4）
  const fingerprint = buildFingerprint(ex);
  const dup = await db().rows<{ id: number }>(
    "SELECT id FROM slips WHERE fingerprint = :fingerprint",
    { fingerprint }
  );
  if (dup.length > 0) {
    const dupId = dup[0].id;
    await logIntake({
      sourceType,
      sourceRef,
      result: "duplicate",
      slipId: dupId,
      note: `指紋一致（既存伝票 #${dupId}）`,
    });
    return {
      file: sourceRef,
      result: "duplicate",
      slipId: dupId,
      message: `既存の伝票 #${dupId} と同一指紋のため取込を弾きました。`,
    };
  }

  const created = await createSlip(ex, sourceRef, sourceType);
  await logIntake({
    sourceType,
    sourceRef,
    result: "slip_created",
    slipId: created.slipId,
  });
  return {
    file: sourceRef,
    result: "slip_created",
    slipId: created.slipId,
    message: `伝票 #${created.slipId} を起票しました（確認フォームで確定してください）。`,
    holdCount: created.holdCount,
    confidence: ex.confidence,
    shipperName: created.shipperName,
    slipTypeLabel: ex.slip_type === "inbound" ? "入庫" : "出庫",
  };
}

/**
 * PDF 1件を取り込む（画面アップロード・メール添付で共用）。
 * Blob へ原本を保管 → Claude読取 → intakeExtraction。
 * エラーも intake_logs に記録する（黙って捨てない）。
 */
export async function intakePdf(
  pdf: Buffer,
  filename: string,
  sourceType: "fax" | "mail"
): Promise<IntakeResult> {
  const blobUrl = await storePdf(filename, pdf);
  const sourceRef = blobUrl ?? filename;
  try {
    const ex = await extractSlipFromPdf(pdf);
    return await intakeExtraction(ex, sourceRef, sourceType);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logIntake({ sourceType, sourceRef, result: "error", note: message });
    return { file: filename, result: "error", message };
  }
}

/** 取込結果を Slack へ通知する（アップロード・メール取込の呼び出し側から使う） */
export async function notifyIntakeResults(results: IntakeResult[]): Promise<void> {
  if (results.length === 0) return;
  await notifySlack(buildIntakeNotification(results));
}

/** Slack向け取込結果メッセージ（届いています／要確認／無関係／エラー） */
export function buildIntakeNotification(results: IntakeResult[]): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const lines: string[] = ["📥 入出庫依頼の取込結果"];

  const created = results.filter((r) => r.result === "slip_created");
  if (created.length > 0) {
    lines.push(`\n*届いています（${created.length}件）*`);
    for (const r of created) {
      const flags: string[] = [];
      if ((r.holdCount ?? 0) > 0) flags.push(`保留${r.holdCount}行`);
      if (r.confidence === "low") flags.push("読取確信度: 低");
      const mark = flags.length > 0 ? ` ⚠️ 要確認（${flags.join("・")}）` : "";
      lines.push(
        `• <${base}/slips/${r.slipId}|伝票 #${r.slipId}> ${r.shipperName ?? "荷主未確定"}・${r.slipTypeLabel ?? ""}${mark}`
      );
    }
  }

  const duplicates = results.filter((r) => r.result === "duplicate");
  if (duplicates.length > 0) {
    lines.push(`\n*二重読込を弾きました（${duplicates.length}件）*`);
    for (const r of duplicates) lines.push(`• ${r.file}（既存 #${r.slipId}）`);
  }

  const irrelevant = results.filter((r) => r.result === "irrelevant");
  if (irrelevant.length > 0) {
    lines.push(`\n*⚠️ 入出庫と無関係な文書（${irrelevant.length}件・要確認）*`);
    for (const r of irrelevant) lines.push(`• ${r.file}：${r.message}`);
  }

  const errors = results.filter((r) => r.result === "error");
  if (errors.length > 0) {
    lines.push(`\n*🚨 読取エラー（${errors.length}件・要確認）*`);
    for (const r of errors) lines.push(`• ${r.file}：${r.message}`);
  }

  lines.push(`\n内容の確定は確認フォームから： ${base}/slips`);
  return lines.join("\n");
}
