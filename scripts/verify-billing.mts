// 請求処理（三期制・荷役料）の検証スクリプト
// シナリオ: 6月末スナップショット（期首の起点）→ 7月の確定伝票 → 請求計算・確定。
// 期待値は手計算で固定（決定的計算の検証）。
//   実行: npm run verify:billing（ローカル docker Postgres が起動していること）
import fs from "node:fs/promises";
import { getPool, db } from "../lib/db";
import { confirmSlip } from "../lib/inventory";
import { finalizeMonth, addSnapshotOverride, getSnapshot } from "../lib/closing";
import {
  upsertTariff,
  calcMonthlyBilling,
  finalizeInvoice,
  getInvoice,
  listInvoices,
} from "../lib/billing";

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

// 6月末スナップショット（期首の起点）: seed の在庫がそのまま6月末残になる
// マルノウ(1): item1 コロッケ1kg 300+500=800
// 北洋(2): item3 ホタテ 120+80=200
// 東部(3): item4 養生シート 40
const f = await finalizeMonth({ month: "2026-06", operator: "op01" });
check("6月末スナップショット確定", f.ok === true, f);

// 表示値修正が期首に効くことの検証用: マルノウ item1 の 300 の行を 310 に修正（合計 810 になる）
{
  const snap = await getSnapshot("2026-06");
  const target = snap.find((s) => s.item_name === "冷凍コロッケ" && Number(s.quantity) === 300)!;
  const o = await addSnapshotOverride({
    snapshotId: target.id, overrideQuantity: 310,
    reason: "メーカー様帳簿との突合により（検証）", operator: "op01",
  });
  check("6月末の表示値修正（300→310）", o.ok === true, o);
}

// 7月の伝票を確定（seed: 伝票1=7/9 マルノウ出庫400、伝票2=7/9 北洋出庫50、
// 伝票3=7/10 東部入庫20、伝票4=7/10 北洋出庫100(マイナス承認)）
for (const [slipId, allowNegative] of [[1, false], [2, false], [3, false], [4, true]] as const) {
  const r = await confirmSlip({ slipId, operator: "op01", expectedVersion: 0, allowNegative, allowDateMismatch: true });
  check(`伝票${slipId} 確定`, r.ok === true, r);
}

console.log("\n— タリフ登録 —");
{
  // マルノウ: 荷主既定（保管10/期・入庫5・出庫5）
  const t1 = await upsertTariff({
    shipperId: 1, itemId: null, storageRate: 10, handlingInRate: 5, handlingOutRate: 5,
    note: "基本料率", operator: "op01",
  });
  check("荷主既定タリフ登録", t1.ok === true, t1);
  // マルノウ item1 の品目上書き（保管12/期）→ 品目一致が既定に勝つことを検証
  const t2 = await upsertTariff({
    shipperId: 1, itemId: 1, storageRate: 12, handlingInRate: 5, handlingOutRate: 6,
    note: "コロッケ1kg特約", operator: "op01",
  });
  check("品目上書きタリフ登録", t2.ok === true, t2);
  // 同一キーの upsert（更新）
  const t3 = await upsertTariff({
    shipperId: 1, itemId: 1, storageRate: 12, handlingInRate: 5, handlingOutRate: 5,
    note: "コロッケ1kg特約（出庫5に訂正）", operator: "op01",
  });
  check("同一キーは更新（upsert）", t3.ok === true, t3);
}

console.log("\n— 三期制計算（マルノウ食品） —");
{
  // 期首（6月末表示値）: item1 = 810（310+500）
  // 7月の動き: 7/9 出庫400（1期）
  // 1期: 期首810 + 入庫0 = 課金810 → 810×12 = 9720円 / 期末 410
  // 2期: 期首410 → 課金410 → 4920円
  // 3期: 期首410 → 課金410 → 4920円
  // 保管料計 19560円 / 出庫荷役 400×5 = 2000円 / 合計 21560円
  const p = await calcMonthlyBilling(1, "2026-07");
  if ("error" in p) { check("計算成功", false, p); }
  else {
    const it = p.items.find((i) => i.itemId === 1)!;
    check("期首在庫に表示値修正が効く（810）", it.periods[0].openingQty === 810, it.periods[0]);
    check("1期 課金810・9720円", it.periods[0].billableQty === 810 && it.periods[0].amount === 9720, it.periods[0]);
    check("2期 課金410・4920円", it.periods[1].billableQty === 410 && it.periods[1].amount === 4920, it.periods[1]);
    check("3期 課金410・4920円", it.periods[2].billableQty === 410 && it.periods[2].amount === 4920, it.periods[2]);
    check("保管料合計 19560円", it.storageAmount === 19560, it.storageAmount);
    check("出庫荷役 2000円（品目上書き 5円/個）", it.handlingOutAmount === 2000, it.handlingOutAmount);
    check("荷主合計 21560円", p.totalAmount === 21560, p.totalAmount);
    check("警告なし", p.warnings.length === 0, p.warnings);
  }
}

console.log("\n— タリフ未設定の警告（北洋水産） —");
{
  // 北洋はタリフ未登録: 金額0で計上＋警告
  const p = await calcMonthlyBilling(2, "2026-07");
  if ("error" in p) { check("計算成功", false, p); }
  else {
    check("タリフ未設定の警告が出る", p.warnings.length > 0, p.warnings);
    check("金額は0（黙って落とさない）", p.totalAmount === 0, p.totalAmount);
    const it = p.items[0];
    check("数量は正しく積む（期首200・出庫150）", it.periods[0].openingQty === 200 && it.monthOutQty === 150, it);
  }
}

console.log("\n— 請求書の確定（原本不変・二重確定拒否） —");
{
  const r1 = await finalizeInvoice({ shipperId: 1, month: "2026-07", operator: "op01" });
  check("確定成功", r1.ok === true, r1);
  if (r1.ok) {
    const inv = await getInvoice(r1.invoiceId);
    check("合計 21560円で保存", Number(inv!.invoice.total_amount) === 21560, inv!.invoice.total_amount);
    const storageLines = inv!.lines.filter((l) => l.category === "storage");
    check("保管料明細 3期分", storageLines.length === 3, storageLines.length);
    check("出庫荷役明細あり", inv!.lines.some((l) => l.category === "handling_out"));
    const logs = await db().rows(
      "SELECT * FROM edit_logs WHERE target_type = 'invoice' AND action = 'finalize'");
    check("確定履歴が残る", logs.length === 1);
  }
  const r2 = await finalizeInvoice({ shipperId: 1, month: "2026-07", operator: "op01" });
  check("二重確定は拒否", r2.ok === false, r2);
  const list = await listInvoices();
  check("請求書一覧に載る", list.length === 1 && list[0].shipper_name === "マルノウ食品株式会社");
}

console.log(`\n結果: ${passed} passed / ${failed} failed`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
