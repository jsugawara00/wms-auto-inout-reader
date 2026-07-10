import { db, withTransaction, type Queryable } from "./db";
import { normalizeItemName, normalizeShipperName } from "./normalize";
import type { AllocationRule, Item, Shipper } from "./types";

// マスタ管理（リメイクの新規機能）：商品マスタ・荷主マスタの CRUD ＋統合マージ。
// 「判断基準の外出し」の思想はそのまま：荷主の引き当てルールはコードでなくマスタ列で持つ。
// 更新・統合はすべて edit_logs に理由つきで残す（黙って上書きしない）。

// ============================================================
// 商品マスタ
// ============================================================

export interface ItemListRow extends Item {
  shipper_name: string;
  stock_count: number;
}

export async function listItems(shipperId?: number): Promise<ItemListRow[]> {
  const where = shipperId ? "WHERE i.shipper_id = :shipperId" : "";
  return db().rows<ItemListRow>(
    `SELECT i.*, sh.name AS shipper_name,
            (SELECT COUNT(*) FROM stock st WHERE st.item_id = i.id) AS stock_count
     FROM items i
     JOIN shippers sh ON sh.id = i.shipper_id
     ${where}
     ORDER BY sh.name, i.name, i.spec`,
    shipperId ? { shipperId } : {}
  );
}

export type MasterResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function createItem(input: {
  shipperId: number;
  name: string;
  spec: string;
  itemCode: string;
  unitPrice: number | null;
  operator: string;
}): Promise<MasterResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "品名を入力してください。" };
  if (input.unitPrice !== null && !Number.isFinite(input.unitPrice)) {
    return { ok: false, message: "単価が不正です。" };
  }

  return withTransaction(async (conn): Promise<MasterResult> => {
    const dup = await conn.rows<{ id: number }>(
      "SELECT id FROM items WHERE shipper_id = :shipperId AND name = :name AND spec = :spec",
      { shipperId: input.shipperId, name, spec: input.spec.trim() }
    );
    if (dup.length > 0) {
      return { ok: false, message: "同じ荷主・品名・規格の品目が既に存在します。" };
    }
    const ins = await conn.rows<{ id: number }>(
      `INSERT INTO items (shipper_id, name, spec, name_normalized, item_code, unit_price)
       VALUES (:shipperId, :name, :spec, :nameNormalized, :itemCode, :unitPrice)
       RETURNING id`,
      {
        shipperId: input.shipperId,
        name,
        spec: input.spec.trim(),
        nameNormalized: normalizeItemName(name),
        itemCode: input.itemCode.trim(),
        unitPrice: input.unitPrice,
      }
    );
    await logMaster(conn, "item", ins[0].id, "create", `商品マスタ登録：${name} ${input.spec.trim() || "規格なし"}`, input.operator);
    return { ok: true, message: `品目「${name}」を登録しました。` };
  });
}

export async function updateItem(input: {
  itemId: number;
  name: string;
  spec: string;
  itemCode: string;
  unitPrice: number | null;
  operator: string;
}): Promise<MasterResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "品名を入力してください。" };

  return withTransaction(async (conn): Promise<MasterResult> => {
    const rows = await conn.rows<Item>("SELECT * FROM items WHERE id = :itemId FOR UPDATE", {
      itemId: input.itemId,
    });
    const item = rows[0];
    if (!item) return { ok: false, message: "品目が見つかりません。" };

    const dup = await conn.rows<{ id: number }>(
      `SELECT id FROM items WHERE shipper_id = :shipperId AND name = :name AND spec = :spec AND id <> :itemId`,
      { shipperId: item.shipper_id, name, spec: input.spec.trim(), itemId: input.itemId }
    );
    if (dup.length > 0) {
      return { ok: false, message: "同じ荷主・品名・規格の別品目が既に存在します（統合をご検討ください）。" };
    }

    const changes: string[] = [];
    if (item.name !== name) changes.push(`品名 ${item.name}→${name}`);
    if (item.spec !== input.spec.trim()) changes.push(`規格 ${item.spec || "なし"}→${input.spec.trim() || "なし"}`);
    if (item.item_code !== input.itemCode.trim()) changes.push(`商品コード ${item.item_code || "なし"}→${input.itemCode.trim() || "なし"}`);
    if (Number(item.unit_price ?? NaN) !== Number(input.unitPrice ?? NaN)) {
      changes.push(`単価 ${item.unit_price ?? "なし"}→${input.unitPrice ?? "なし"}`);
    }
    if (changes.length === 0) return { ok: false, message: "変更点がありません。" };

    await conn.exec(
      `UPDATE items SET name = :name, spec = :spec, name_normalized = :nameNormalized,
              item_code = :itemCode, unit_price = :unitPrice
       WHERE id = :itemId`,
      {
        name,
        spec: input.spec.trim(),
        nameNormalized: normalizeItemName(name),
        itemCode: input.itemCode.trim(),
        unitPrice: input.unitPrice,
        itemId: input.itemId,
      }
    );
    await logMaster(conn, "item", input.itemId, "update", `商品マスタ修正：${changes.join(" / ")}`, input.operator);
    return { ok: true, message: `品目「${name}」を更新しました。` };
  });
}

/**
 * 品目の統合（マージ）：表記ゆれで分裂した品目を1つに寄せる。
 * sourceItem の在庫・伝票明細・スナップショットを targetItem へ付け替え、source を削除。
 * 在庫は同一キーが衝突する場合は数量を合算する。
 */
export async function mergeItems(input: {
  sourceItemId: number;
  targetItemId: number;
  operator: string;
}): Promise<MasterResult> {
  const { sourceItemId, targetItemId, operator } = input;
  if (sourceItemId === targetItemId) {
    return { ok: false, message: "統合元と統合先が同じです。" };
  }

  return withTransaction(async (conn): Promise<MasterResult> => {
    const rows = await conn.rows<Item>(
      "SELECT * FROM items WHERE id IN (:a, :b) FOR UPDATE",
      { a: sourceItemId, b: targetItemId }
    );
    const source = rows.find((r) => r.id === sourceItemId);
    const target = rows.find((r) => r.id === targetItemId);
    if (!source || !target) return { ok: false, message: "統合対象の品目が見つかりません。" };
    if (source.shipper_id !== target.shipper_id) {
      return { ok: false, message: "異なる荷主の品目は統合できません。" };
    }

    // 在庫：衝突キーは合算、非衝突は付け替え
    const sourceStocks = await conn.rows<{
      id: number;
      warehouse_id: number;
      production_date_key: string;
      lot_no: string;
      order_no: string;
      quantity: number;
    }>("SELECT id, warehouse_id, production_date_key, lot_no, order_no, quantity FROM stock WHERE item_id = :src FOR UPDATE", { src: sourceItemId });

    for (const st of sourceStocks) {
      const clash = await conn.rows<{ id: number }>(
        `SELECT id FROM stock
         WHERE item_id = :tgt AND warehouse_id = :wh AND production_date_key = :pdk
           AND lot_no = :lot AND order_no = :ord FOR UPDATE`,
        { tgt: targetItemId, wh: st.warehouse_id, pdk: st.production_date_key, lot: st.lot_no, ord: st.order_no }
      );
      if (clash.length > 0) {
        await conn.exec(
          "UPDATE stock SET quantity = quantity + :qty, version = version + 1 WHERE id = :id",
          { qty: st.quantity, id: clash[0].id }
        );
        await conn.exec("DELETE FROM stock WHERE id = :id", { id: st.id });
      } else {
        await conn.exec("UPDATE stock SET item_id = :tgt WHERE id = :id", { tgt: targetItemId, id: st.id });
      }
    }

    // 伝票明細を付け替え（履歴の追跡性のため item_name_raw は変えない）
    await conn.exec("UPDATE slip_lines SET item_id = :tgt WHERE item_id = :src", {
      tgt: targetItemId,
      src: sourceItemId,
    });
    await conn.exec("DELETE FROM items WHERE id = :src", { src: sourceItemId });

    const reason = `品目統合：「${source.name} ${source.spec || "規格なし"}」(#${sourceItemId}) を「${target.name} ${target.spec || "規格なし"}」(#${targetItemId}) へ統合`;
    await logMaster(conn, "item", targetItemId, "update", reason, operator);
    return { ok: true, message: reason };
  });
}

// ============================================================
// 荷主マスタ
// ============================================================

export interface ShipperListRow extends Shipper {
  item_count: number;
}

export async function listShipperMasters(): Promise<ShipperListRow[]> {
  return db().rows<ShipperListRow>(
    `SELECT sh.*, (SELECT COUNT(*) FROM items i WHERE i.shipper_id = sh.id) AS item_count
     FROM shippers sh ORDER BY sh.name`
  );
}

export async function getShipper(id: number): Promise<Shipper | null> {
  const rows = await db().rows<Shipper>("SELECT * FROM shippers WHERE id = :id", { id });
  return rows[0] ?? null;
}

export interface ShipperInput {
  name: string;
  aliases: string[];
  allocationRule: AllocationRule;
  productionDateManaged: boolean;
  exceptionsNote: string;
  section: string;
  phone: string;
  fax: string;
  email: string;
  operator: string;
}

export async function createShipper(input: ShipperInput): Promise<MasterResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "荷主名を入力してください。" };
  const key = normalizeShipperName(name);

  return withTransaction(async (conn): Promise<MasterResult> => {
    const dup = await conn.rows<{ name: string }>(
      "SELECT name FROM shippers WHERE name_normalized = :key",
      { key }
    );
    if (dup.length > 0) {
      return { ok: false, message: `同一とみられる荷主「${dup[0].name}」が既に登録されています。` };
    }
    const ins = await conn.rows<{ id: number }>(
      `INSERT INTO shippers
         (name, name_normalized, aliases, allocation_rule, production_date_managed,
          exceptions_note, section, phone, fax, email)
       VALUES (:name, :key, :aliases, :allocationRule, :productionDateManaged,
               :exceptionsNote, :section, :phone, :fax, :email)
       RETURNING id`,
      {
        name,
        key,
        aliases: JSON.stringify(input.aliases),
        allocationRule: input.allocationRule,
        productionDateManaged: input.productionDateManaged,
        exceptionsNote: input.exceptionsNote.trim(),
        section: input.section.trim() || null,
        phone: input.phone.trim() || null,
        fax: input.fax.trim() || null,
        email: input.email.trim() || null,
      }
    );
    await logMaster(conn, "shipper", ins[0].id, "create", `荷主マスタ登録：${name}`, input.operator);
    return { ok: true, message: `荷主「${name}」を登録しました。` };
  });
}

export async function updateShipper(
  shipperId: number,
  input: ShipperInput
): Promise<MasterResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "荷主名を入力してください。" };
  const key = normalizeShipperName(name);

  return withTransaction(async (conn): Promise<MasterResult> => {
    const rows = await conn.rows<Shipper>("SELECT * FROM shippers WHERE id = :id FOR UPDATE", {
      id: shipperId,
    });
    const cur = rows[0];
    if (!cur) return { ok: false, message: "荷主が見つかりません。" };

    const dup = await conn.rows<{ name: string }>(
      "SELECT name FROM shippers WHERE name_normalized = :key AND id <> :id",
      { key, id: shipperId }
    );
    if (dup.length > 0) {
      return { ok: false, message: `同一とみられる別荷主「${dup[0].name}」が既に存在します。` };
    }

    const changes: string[] = [];
    if (cur.name !== name) changes.push(`名称 ${cur.name}→${name}`);
    if (cur.allocation_rule !== input.allocationRule) changes.push(`引き当て ${cur.allocation_rule}→${input.allocationRule}`);
    if (cur.production_date_managed !== input.productionDateManaged) changes.push(`製造日管理 ${cur.production_date_managed ? "あり" : "なし"}→${input.productionDateManaged ? "あり" : "なし"}`);
    if ((cur.exceptions_note ?? "") !== input.exceptionsNote.trim()) changes.push("特殊例外を更新");
    const curAliases = JSON.stringify(Array.isArray(cur.aliases) ? cur.aliases : []);
    if (curAliases !== JSON.stringify(input.aliases)) changes.push("別名を更新");

    await conn.exec(
      `UPDATE shippers SET name = :name, name_normalized = :key, aliases = :aliases,
              allocation_rule = :allocationRule, production_date_managed = :productionDateManaged,
              exceptions_note = :exceptionsNote, section = :section, phone = :phone,
              fax = :fax, email = :email
       WHERE id = :id`,
      {
        name,
        key,
        aliases: JSON.stringify(input.aliases),
        allocationRule: input.allocationRule,
        productionDateManaged: input.productionDateManaged,
        exceptionsNote: input.exceptionsNote.trim(),
        section: input.section.trim() || null,
        phone: input.phone.trim() || null,
        fax: input.fax.trim() || null,
        email: input.email.trim() || null,
        id: shipperId,
      }
    );
    await logMaster(
      conn,
      "shipper",
      shipperId,
      "update",
      `荷主マスタ修正：${changes.length > 0 ? changes.join(" / ") : "連絡先等"}`,
      input.operator
    );
    return { ok: true, message: `荷主「${name}」を更新しました。` };
  });
}

async function logMaster(
  conn: Queryable,
  targetType: "item" | "shipper",
  targetId: number,
  action: "create" | "update",
  reason: string,
  operator: string
): Promise<void> {
  await conn.exec(
    `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
     VALUES (:targetType, :targetId, :action, :reason, :operator)`,
    { targetType, targetId, action, reason, operator }
  );
}
