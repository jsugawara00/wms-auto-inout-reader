import type { Queryable } from "./db";
import { db } from "./db";
import type { Shipper, ShipperRule } from "./types";
import { normalizeShipperName } from "./normalize";

// 荷主の引き当てルールは shippers テーブルが正（試作の rules/shippers/*.md を廃止しDB化）。
// エンジンはコード分岐を持たず、ここを読んで挙動を決める。
// 「判断基準の外出し」の思想は継承：ルールはデータ、エンジンは汎用のまま。

function toRule(shipper: Shipper): ShipperRule {
  return {
    shipperId: shipper.id,
    shipperName: shipper.name,
    aliases: Array.isArray(shipper.aliases) ? shipper.aliases.map(String) : [],
    allocationRule: shipper.allocation_rule === "lot_specified" ? "lot_specified" : "fifo",
    productionDateManaged: shipper.production_date_managed === true,
    exceptionsBody: shipper.exceptions_note ?? "",
  };
}

/** 荷主IDからルールを読む（確定時の引き当てに使用） */
export async function loadRuleByShipperId(
  conn: Queryable,
  shipperId: number
): Promise<ShipperRule | null> {
  const rows = await conn.rows<Shipper>(
    "SELECT * FROM shippers WHERE id = :shipperId",
    { shipperId }
  );
  return rows.length > 0 ? toRule(rows[0]) : null;
}

/**
 * 読取結果の荷主名から該当荷主（＝ルール）を探す。
 * 1) 正式名称・エイリアスの正規化キーで完全一致
 * 2) 完全一致が無ければ前方一致（「会社名＋部署」連記対策）。
 *    ただし一意に1荷主へ絞れた場合のみ。複数一致は決めつけず null（担当確認へ）。
 */
export async function findRuleByName(rawName: string): Promise<ShipperRule | null> {
  const key = normalizeShipperName(rawName);
  if (!key) return null;
  const shippers = await db().rows<Shipper>("SELECT * FROM shippers ORDER BY id");
  const rules = shippers.map(toRule);

  for (const rule of rules) {
    const candidates = [rule.shipperName, ...rule.aliases];
    if (candidates.some((c) => normalizeShipperName(c) === key)) return rule;
  }

  const prefixHits = rules.filter((rule) =>
    [rule.shipperName, ...rule.aliases].some((c) => {
      const candidateKey = normalizeShipperName(c);
      return candidateKey.length >= 2 && key.startsWith(candidateKey);
    })
  );
  return prefixHits.length === 1 ? prefixHits[0] : null;
}
