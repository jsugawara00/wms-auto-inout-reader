// マスタ管理（新規機能）の検証：商品/荷主 CRUD ＋ 品目統合マージ。
//   実行: npm run verify:masters（ローカル docker Postgres が起動していること）
import fs from "node:fs/promises";
import { getPool, db } from "../lib/db";
import {
  createShipper,
  updateShipper,
  createItem,
  updateItem,
  mergeItems,
  listItems,
} from "../lib/masters";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail ?? ""); }
}

const pool = getPool();
console.log("— DBリセット＋スキーマ＋シード —");
await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
await pool.query(await fs.readFile("db/schema.sql", "utf-8"));
await pool.query(await fs.readFile("db/seed.sql", "utf-8"));
console.log("  done");

console.log("\n— 荷主マスタ CRUD —");
{
  const dup = await createShipper({
    name: "マルノウ食品(株)", aliases: [], allocationRule: "fifo", productionDateManaged: true,
    exceptionsNote: "", section: "", phone: "", fax: "", email: "", operator: "op01",
  });
  check("正規化キー衝突で重複拒否", dup.ok === false, dup);

  const created = await createShipper({
    name: "山田水産株式会社", aliases: ["ヤマダ水産(株)"], allocationRule: "lot_specified",
    productionDateManaged: true, exceptionsNote: "指定ロット厳守", section: "水産部",
    phone: "0120-0", fax: "", email: "y@example.com", operator: "op01",
  });
  check("新規荷主の登録成功", created.ok === true, created);
  const shipper = (await db().rows<{ id: number; aliases: string[]; allocation_rule: string }>(
    "SELECT id, aliases, allocation_rule FROM shippers WHERE name_normalized = :k",
    { k: "山田水産" }))[0];
  check("エイリアスが保存される", shipper.aliases.includes("ヤマダ水産(株)"), shipper.aliases);
  check("引き当てルールが保存される", shipper.allocation_rule === "lot_specified");

  const upd = await updateShipper(shipper.id, {
    name: "山田水産株式会社", aliases: ["ヤマダ水産(株)", "山田水産"], allocationRule: "fifo",
    productionDateManaged: false, exceptionsNote: "変更後", section: "水産部",
    phone: "0120-0", fax: "", email: "y@example.com", operator: "op02",
  });
  check("荷主の更新成功", upd.ok === true, upd);
  const after = (await db().rows<{ allocation_rule: string; production_date_managed: boolean }>(
    "SELECT allocation_rule, production_date_managed FROM shippers WHERE id = :id", { id: shipper.id }))[0];
  check("ルール変更が反映", after.allocation_rule === "fifo" && after.production_date_managed === false, after);
  const logs = await db().rows("SELECT * FROM edit_logs WHERE target_type='shipper' AND action='update'");
  check("更新履歴が残る", logs.length >= 1);
}

console.log("\n— 商品マスタ CRUD —");
{
  const created = await createItem({
    shipperId: 1, name: "冷凍コロッケ", spec: "2kg", itemCode: "MN-CRQ-2000", unitPrice: 900, operator: "op01",
  });
  check("新規品目の登録成功", created.ok === true, created);
  const dup = await createItem({
    shipperId: 1, name: "冷凍コロッケ", spec: "2kg", itemCode: "", unitPrice: null, operator: "op01",
  });
  check("同一 荷主×品名×規格 は重複拒否", dup.ok === false, dup);

  const item = (await db().rows<{ id: number }>(
    "SELECT id FROM items WHERE shipper_id=1 AND name='冷凍コロッケ' AND spec='2kg'"))[0];
  const upd = await updateItem({
    itemId: item.id, name: "冷凍コロッケ", spec: "2kg", itemCode: "MN-CRQ-2000", unitPrice: 950, operator: "op02",
  });
  check("単価の更新成功", upd.ok === true, upd);
  const price = (await db().rows<{ unit_price: number }>(
    "SELECT unit_price FROM items WHERE id = :id", { id: item.id }))[0];
  check("単価が反映", Number(price.unit_price) === 950, price);
}

console.log("\n— 品目統合マージ（在庫合算・履歴付け替え） —");
{
  // マルノウに重複品目を作る：item#1(冷凍コロッケ1kg・在庫あり) へ 新item を寄せる
  await createItem({ shipperId: 1, name: "冷凍ｺﾛｯｹ", spec: "1kg", itemCode: "", unitPrice: null, operator: "op01" });
  const src = (await db().rows<{ id: number }>(
    "SELECT id FROM items WHERE shipper_id=1 AND name='冷凍ｺﾛｯｹ'"))[0];
  // source に在庫を1行足す（item#1 と同じ倉庫2・製造日2026-06-01 → 統合で合算されるはず）
  await db().exec(
    `INSERT INTO stock (warehouse_id, item_id, production_date, lot_no, order_no, quantity)
     VALUES (2, :src, '2026-06-01', '', '', 100)`, { src: src.id });
  // source に非衝突の在庫（別倉庫）も足す → 付け替えされるはず
  await db().exec(
    `INSERT INTO stock (warehouse_id, item_id, production_date, lot_no, order_no, quantity)
     VALUES (1, :src, '2026-06-01', '', '', 5)`, { src: src.id });

  const before = (await db().rows<{ q: number }>(
    "SELECT quantity AS q FROM stock WHERE item_id=1 AND warehouse_id=2 AND production_date='2026-06-01'"))[0];

  const merged = await mergeItems({ sourceItemId: src.id, targetItemId: 1, operator: "op01" });
  check("統合成功", merged.ok === true, merged);

  const srcGone = await db().rows("SELECT id FROM items WHERE id = :id", { id: src.id });
  check("統合元の品目は削除される", srcGone.length === 0);
  const clash = (await db().rows<{ q: number }>(
    "SELECT quantity AS q FROM stock WHERE item_id=1 AND warehouse_id=2 AND production_date='2026-06-01'"))[0];
  check("衝突キーの在庫は合算される", Number(clash.q) === Number(before.q) + 100, { before: before.q, after: clash.q });
  const moved = await db().rows(
    "SELECT id FROM stock WHERE item_id=1 AND warehouse_id=1 AND production_date='2026-06-01'");
  check("非衝突キーの在庫は付け替えられる", moved.length === 1);

  const self = await mergeItems({ sourceItemId: 1, targetItemId: 1, operator: "op01" });
  check("自分自身への統合は拒否", self.ok === false, self);
  const crossShipper = await mergeItems({ sourceItemId: 1, targetItemId: 3, operator: "op01" });
  check("異なる荷主間の統合は拒否", crossShipper.ok === false, crossShipper);
}

console.log("\n— 一覧取得 —");
{
  const items = await listItems();
  check("商品一覧に在庫件数が付く", items.every((i) => typeof i.stock_count === "number"));
  check("荷主名が結合される", items.every((i) => i.shipper_name.length > 0));
}

console.log(`\n結果: ${passed} passed / ${failed} failed`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
