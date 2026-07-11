import type { Queryable } from "./db";
import { normalizeItemName, normalizeSpec } from "./normalize";

// 品目照合（取込時・荷主確定後の再照合で共用）
// - 商品コード完全一致＋品名一致 → 自動紐付け（コード探しゼロ：FB⑤）
// - 商品コード一致だが品名不一致 → 決めつけず保留（候補提示。コード誤読の可能性）
// - 完全一致（正規化キー）のみ自動紐付け
// - 品名一致・規格不一致 → 保留（候補提示）
// - 一致なしでも、読取ロットが既存在庫のロットと一意に一致すれば
//   「既存品目『◯◯』のことですか？」と候補を提示（実FAXテストでの改善）

export interface MatchResult {
  itemId: number | null;
  lineStatus: "ok" | "hold";
  holdReason: string | null;
}

export async function matchItemForLine(
  conn: Queryable,
  shipperId: number,
  line: { itemNameRaw: string; specRaw: string; lotNo: string; itemCodeRaw?: string }
): Promise<MatchResult> {
  const nameKey = normalizeItemName(line.itemNameRaw);
  const specKey = normalizeSpec(line.specRaw);
  const codeRaw = line.itemCodeRaw?.trim() ?? "";

  // 商品コード照合（マスタで管理された一意性の高いキー。空コードは対象外）
  if (codeRaw) {
    const codeHits = await conn.rows<{ id: number; name: string; spec: string }>(
      `SELECT id, name, spec FROM items
       WHERE shipper_id = :shipperId AND item_code <> '' AND item_code = :codeRaw`,
      { shipperId, codeRaw }
    );
    if (codeHits.length === 1) {
      const hit = codeHits[0];
      // 品名（または規格込み）でクロスチェックできたら自動紐付け。
      // 品名も規格も読取できていない場合はコードのみで紐付ける。
      const nameAgrees = !nameKey || normalizeItemName(hit.name) === nameKey;
      if (nameAgrees) {
        return { itemId: hit.id, lineStatus: "ok", holdReason: null };
      }
      // コードは一致するが品名が食い違う → 誤読の可能性があるため担当へ
      return {
        itemId: null,
        lineStatus: "hold",
        holdReason: `商品コード ${codeRaw} は既存品目「${hit.name} ${hit.spec || "規格なし"}」と一致しますが、読取の品名（${line.itemNameRaw}）と異なります。この品目ですか？`,
      };
    }
  }

  const candidates = await conn.rows<{ id: number; name: string; spec: string }>(
    `SELECT id, name, spec FROM items
     WHERE shipper_id = :shipperId AND name_normalized = :nameKey`,
    { shipperId, nameKey }
  );
  const exact = candidates.find((c) => normalizeSpec(String(c.spec)) === specKey);
  if (exact) {
    return { itemId: exact.id, lineStatus: "ok", holdReason: null };
  }
  if (candidates.length > 0) {
    // 品名は同じだが規格が違う（1.80≠1.85 等）→ 必ず担当へ
    return {
      itemId: null,
      lineStatus: "hold",
      holdReason: `既存品目と品名一致・規格不一致（既存: ${candidates
        .map((c) => c.spec || "規格なし")
        .join(", ")} / 読取: ${line.specRaw || "規格なし"}）。既存品目か新規品目か確認してください。`,
    };
  }

  // ロットヒント：読取ロットが既存在庫のロットと一致する品目を探す
  if (line.lotNo) {
    const lotHits = await conn.rows<{ id: number; name: string; spec: string }>(
      `SELECT DISTINCT i.id, i.name, i.spec
       FROM stock st JOIN items i ON i.id = st.item_id
       WHERE i.shipper_id = :shipperId AND st.lot_no = :lotNo`,
      { shipperId, lotNo: line.lotNo }
    );
    if (lotHits.length === 1) {
      const hit = lotHits[0];
      return {
        itemId: null,
        lineStatus: "hold",
        holdReason: `品名では一致しませんが、ロット ${line.lotNo} は既存品目「${hit.name} ${hit.spec || "規格なし"}」の在庫と一致します。この品目ですか？（読取: ${line.itemNameRaw}）`,
      };
    }
  }

  return {
    itemId: null,
    lineStatus: "hold",
    holdReason: "既存品目に一致なし。誤記か新規品目か、現物・荷主に確認してください。",
  };
}
