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
  createDraftInvoice,
  recomputeDraft,
  adjustInvoiceLine,
  addManualLine,
  deleteManualLine,
  issueInvoice,
  reopenInvoice,
  getInvoice,
  listInvoices,
  lineEffectiveAmount,
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

console.log("\n— 締め（下書き作成）＋二重締め拒否 —");
let invoiceId = 0;
{
  const r1 = await createDraftInvoice({ shipperId: 1, month: "2026-07", operator: "op01" });
  check("締め成功（下書き）", r1.ok === true, r1);
  if (r1.ok) {
    invoiceId = r1.invoiceId;
    const inv = await getInvoice(invoiceId);
    check("status は draft", inv!.invoice.status === "draft", inv!.invoice.status);
    check("合計 21560円で保存", Number(inv!.invoice.total_amount) === 21560, inv!.invoice.total_amount);
    check("保管料明細 3期分", inv!.lines.filter((l) => l.category === "storage").length === 3);
    check("出庫荷役明細あり", inv!.lines.some((l) => l.category === "handling_out"));
  }
  const r2 = await createDraftInvoice({ shipperId: 1, month: "2026-07", operator: "op01" });
  check("二重締めは拒否", r2.ok === false, r2);
}

console.log("\n— 確認フォーム：行金額の調整（原本不変） —");
{
  const inv = await getInvoice(invoiceId);
  const storage1 = inv!.lines.find((l) => l.category === "storage" && l.period_no === 1)!; // 9720円
  const a = await adjustInvoiceLine({ lineId: storage1.id, adjustedAmount: 9000, reason: "端数調整（検証）", operator: "op01" });
  check("行金額の調整成功", a.ok === true, a);
  const inv2 = await getInvoice(invoiceId);
  const line = inv2!.lines.find((l) => l.id === storage1.id)!;
  check("原本 amount は不変（9720）", Number(line.amount) === 9720, line.amount);
  check("表示値は調整後（9000）", lineEffectiveAmount(line) === 9000, lineEffectiveAmount(line));
  check("合計は調整を反映（21560-720=20840）", Number(inv2!.invoice.total_amount) === 20840, inv2!.invoice.total_amount);
}

console.log("\n— 確認フォーム：例外請求行の追加・削除 —");
{
  const add = await addManualLine({ invoiceId, itemName: "特別対応費", spec: "", quantity: 1, unitPrice: 5000, operator: "op01" });
  check("例外行の追加成功", add.ok === true, add);
  const inv = await getInvoice(invoiceId);
  const manual = inv!.lines.find((l) => l.category === "manual");
  check("manual 行が1本", inv!.lines.filter((l) => l.category === "manual").length === 1);
  check("合計に算入（20840+5000=25840）", Number(inv!.invoice.total_amount) === 25840, inv!.invoice.total_amount);

  const del = await deleteManualLine({ lineId: manual!.id, operator: "op01" });
  check("例外行の削除成功", del.ok === true, del);
  const inv2 = await getInvoice(invoiceId);
  check("合計が戻る（25840-5000=20840）", Number(inv2!.invoice.total_amount) === 20840, inv2!.invoice.total_amount);
}

console.log("\n— 再計算：計算行は作り直し・例外行は保持 —");
{
  await addManualLine({ invoiceId, itemName: "保険料", spec: "", quantity: 1, unitPrice: 3000, operator: "op01" });
  const before = await getInvoice(invoiceId);
  const adjustedBefore = before!.lines.find((l) => l.category === "storage" && l.period_no === 1)!;
  check("再計算前：調整が残っている", adjustedBefore.adjusted_amount !== null);
  const r = await recomputeDraft({ invoiceId, operator: "op01" });
  check("再計算成功", r.ok === true, r);
  const after = await getInvoice(invoiceId);
  check("例外行（保険料）は保持", after!.lines.some((l) => l.category === "manual" && l.item_name === "保険料"));
  const recomputed = after!.lines.find((l) => l.category === "storage" && l.period_no === 1)!;
  check("計算行の調整はクリアされ原本に戻る（9720）", recomputed.adjusted_amount === null && Number(recomputed.amount) === 9720, recomputed);
  check("合計は再計算値（21560+3000=24560）", Number(after!.invoice.total_amount) === 24560, after!.invoice.total_amount);
}

console.log("\n— 発行（issued：印刷・送付用の締め。編集は再開が必要） —");
{
  const r = await issueInvoice({ invoiceId, operator: "op02" });
  check("発行成功", r.ok === true, r);
  const inv = await getInvoice(invoiceId);
  check("status は issued", inv!.invoice.status === "issued", inv!.invoice.status);
  check("発行者が記録される", inv!.invoice.issued_by === "op02", inv!.invoice.issued_by);

  const a = await adjustInvoiceLine({ lineId: inv!.lines[0].id, adjustedAmount: 1, reason: "x", operator: "op01" });
  check("発行済みは（再開せずに）調整不可", a.ok === false, a);
  const m = await addManualLine({ invoiceId, itemName: "後出し", spec: "", quantity: 1, unitPrice: 1, operator: "op01" });
  check("発行済みは（再開せずに）例外行追加不可", m.ok === false, m);
  const r2 = await issueInvoice({ invoiceId, operator: "op02" });
  check("二重発行は拒否", r2.ok === false, r2);
  const list = await listInvoices();
  check("請求書一覧に載る", list.length === 1 && list[0].shipper_name === "マルノウ食品株式会社");
}

console.log("\n— 再開（issued→draft）：締め後の荷役料・例外追加に対応 —");
{
  const totalBefore = Number((await getInvoice(invoiceId))!.invoice.total_amount);

  const noReason = await reopenInvoice({ invoiceId, reason: "  ", operator: "op02" });
  check("再開は理由必須", noReason.ok === false, noReason);

  const r = await reopenInvoice({ invoiceId, reason: "8/1 荷主要望で特別対応費を追加", operator: "op02" });
  check("再開成功", r.ok === true, r);
  const inv = await getInvoice(invoiceId);
  check("status は draft に戻る", inv!.invoice.status === "draft", inv!.invoice.status);
  check("前回の発行者は履歴として残る", inv!.invoice.issued_by === "op02", inv!.invoice.issued_by);

  // 再開後は例外行の追加ができる
  const m = await addManualLine({ invoiceId, itemName: "特別対応費", spec: "", quantity: 1, unitPrice: 5000, operator: "op01" });
  check("再開後は例外行を追加できる", m.ok === true, m);
  const afterAdd = await getInvoice(invoiceId);
  check("合計に算入される（+5000）", Number(afterAdd!.invoice.total_amount) === totalBefore + 5000, afterAdd!.invoice.total_amount);

  // 再発行できる（発行者を更新）
  const r2 = await issueInvoice({ invoiceId, operator: "op01" });
  check("再発行成功", r2.ok === true, r2);
  const reissued = await getInvoice(invoiceId);
  check("status は再び issued", reissued!.invoice.status === "issued", reissued!.invoice.status);
  check("発行者が最新（op01）に更新される", reissued!.invoice.issued_by === "op01", reissued!.invoice.issued_by);

  // 再開は issued のときだけ許可（draft では拒否）
  await reopenInvoice({ invoiceId, reason: "戻す", operator: "op01" });
  const badReopen = await reopenInvoice({ invoiceId, reason: "二重再開", operator: "op01" });
  check("draft の請求書は再開できない", badReopen.ok === false, badReopen);
}

console.log(`\n結果: ${passed} passed / ${failed} failed`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
