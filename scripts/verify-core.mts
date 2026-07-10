// コアパイプラインの検証スクリプト（工程2の通過ゲート）
// DBをリセット → スキーマ＋シード投入 → 取込〜確定〜在庫〜月末の一連を検証する。
// Claude API は呼ばない（抽出結果はダミーの Extraction を直接渡す）。
//   実行: npm run verify:core（ローカル docker Postgres が起動していること）
import fs from "node:fs/promises";
import { getPool, db } from "../lib/db";
import { intakeExtraction, buildFingerprint } from "../lib/intake";
import type { Extraction } from "../lib/extract";
import { confirmSlip } from "../lib/inventory";
import { resolveLine } from "../lib/resolve";
import { assignShipper } from "../lib/shipper-assign";
import { adjustStock } from "../lib/stock-adjust";
import {
  finalizeMonth,
  addSnapshotOverride,
  getSnapshot,
  effectiveQuantity,
} from "../lib/closing";
import { getDailySummary, listSlips, getSlipDetail } from "../lib/data";
import { normalizeItemName } from "../lib/normalize";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

async function stockQty(where: string, params: Record<string, unknown>): Promise<number | null> {
  const rows = await db().rows<{ quantity: number }>(
    `SELECT quantity FROM stock WHERE ${where}`,
    params
  );
  return rows.length > 0 ? Number(rows[0].quantity) : null;
}

const pool = getPool();

console.log("— DBリセット＋スキーマ＋シード —");
await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
await pool.query(await fs.readFile("db/schema.sql", "utf-8"));
await pool.query(await fs.readFile("db/seed.sql", "utf-8"));
console.log("  done");

console.log("\n— 正規化 —");
check("1.80 と 1.8 は同一キー", normalizeItemName("1.80kg") === normalizeItemName("1.8kg"));
check("1.85 と 1.8 は別キー", normalizeItemName("1.85kg") !== normalizeItemName("1.8kg"));
check("全角 → 半角の寄せ", normalizeItemName("１ｋｇ") === "1kg");

console.log("\n— 伝票1: FIFO出庫（300+500 から 400 → 2ロットまたぎ） —");
{
  const r = await confirmSlip({ slipId: 1, operator: "op01", expectedVersion: 0, allowNegative: false });
  check("確定成功", r.ok === true, r);
  check("古いロットが 0", (await stockQty("item_id = 1 AND production_date = :d", { d: "2026-06-01" })) === 0);
  check("新しいロットが 400", (await stockQty("item_id = 1 AND production_date = :d", { d: "2026-06-20" })) === 400);
}

console.log("\n— 伝票2: 荷主指定ロット出庫（HK-2605 から 50） —");
{
  const r = await confirmSlip({ slipId: 2, operator: "op01", expectedVersion: 0, allowNegative: false });
  check("確定成功", r.ok === true, r);
  check("指定ロットが 70", (await stockQty("lot_no = :l", { l: "HK-2605" })) === 70);
  check("他ロットは不変 80", (await stockQty("lot_no = :l", { l: "HK-2606" })) === 80);
}

console.log("\n— 伝票3: 入庫（製造日管理なし → 既存行へ upsert 加算） —");
{
  const r = await confirmSlip({ slipId: 3, operator: "op02", expectedVersion: 0, allowNegative: false });
  check("確定成功", r.ok === true, r);
  check("在庫 40+20=60（番兵値キーの ON CONFLICT）", (await stockQty("item_id = 4", {})) === 60);
}

console.log("\n— 伝票4: マイナス在庫の関門（80 に対し 100） —");
{
  const r1 = await confirmSlip({ slipId: 4, operator: "op01", expectedVersion: 0, allowNegative: false });
  check("承認なしは negative 警告で停止", !r1.ok && r1.kind === "negative", r1);
  check("警告時は在庫不変 80", (await stockQty("lot_no = :l", { l: "HK-2606" })) === 80);
  const r2 = await confirmSlip({ slipId: 4, operator: "op01", expectedVersion: 0, allowNegative: true });
  check("担当承認で確定成功", r2.ok === true, r2);
  check("在庫 -20（マイナス許容）", (await stockQty("lot_no = :l", { l: "HK-2606" })) === -20);
}

console.log("\n— 確定済み・競合の防御 —");
{
  const r1 = await confirmSlip({ slipId: 1, operator: "op01", expectedVersion: 1, allowNegative: false });
  check("確定済み伝票は再確定不可", !r1.ok && r1.kind === "invalid", r1);
}

console.log("\n— 取込: 表記ゆれ照合＋保留＋二重読込防止 —");
const ex1: Extraction = {
  is_relevant: true,
  slip_type: "inbound",
  slip_number: "MN-20260711-05",
  shipper_name: "マルノウ食品(株)", // エイリアス照合
  shipper_section: "業務用食品部",
  requested_at: "2026-07-11 10:00",
  confidence: "high",
  note: null,
  lines: [
    { item_name: "冷凍コロッケ", spec: "１ｋｇ", production_date: "2026-07-01", lot_no: "", order_no: "", quantity: 100, unit_note: "" },
    { item_name: "冷凍メンチカツ", spec: "1kg", production_date: "2026-07-01", lot_no: "", order_no: "", quantity: 50, unit_note: "" },
  ],
};
let ex1SlipId = 0;
{
  const r = await intakeExtraction(ex1, "verify-ex1.pdf", "fax");
  check("起票成功", r.result === "slip_created", r);
  check("保留1行（未知品目）", r.holdCount === 1, r);
  ex1SlipId = r.slipId!;
  const detail = await getSlipDetail(ex1SlipId);
  check("荷主がエイリアスで自動確定", detail?.slip.shipper_id === 1, detail?.slip);
  check("既存品目へ自動紐付け（全角規格の寄せ）", detail?.lines[0].item_id === 1, detail?.lines[0]);
  check("未知品目は保留", detail?.lines[1].line_status === "hold", detail?.lines[1]);

  const r2 = await intakeExtraction(ex1, "verify-ex1-again.pdf", "fax");
  check("同一指紋は二重読込を弾く", r2.result === "duplicate" && r2.slipId === ex1SlipId, r2);
  check("指紋が決定的", buildFingerprint(ex1) === buildFingerprint(ex1));
}

console.log("\n— 取込: 無関係文書の記録（黙って捨てない） —");
{
  const exIrr: Extraction = { ...ex1, is_relevant: false, slip_type: null, note: "営業案内", lines: [] };
  const r = await intakeExtraction(exIrr, "verify-irrelevant.pdf", "fax");
  check("無関係と記録", r.result === "irrelevant", r);
  const logs = await db().rows<{ result: string }>(
    "SELECT result FROM intake_logs WHERE source_ref = :ref", { ref: "verify-irrelevant.pdf" });
  check("intake_logs に残る", logs.length === 1 && logs[0].result === "irrelevant", logs);
}

console.log("\n— 保留解消: 新規品目として登録 —");
{
  const detail = await getSlipDetail(ex1SlipId);
  const holdLine = detail!.lines.find((l) => l.line_status === "hold")!;
  const r = await resolveLine({
    slipId: ex1SlipId, lineId: holdLine.id, expectedVersion: detail!.slip.version,
    operator: "op01", choice: { type: "new" }, note: "荷主に電話確認済み",
  });
  check("解消成功", r.ok === true, r);
  const after = await getSlipDetail(ex1SlipId);
  check("明細が ok に", after?.lines.every((l) => l.line_status === "ok") === true);
}

console.log("\n— 未知荷主 → 荷主確定（新規登録）→ 照合再実行 —");
const ex2: Extraction = {
  is_relevant: true,
  slip_type: "inbound",
  slip_number: "YS-20260711-01",
  shipper_name: "ヤマダ水産(株)", // 正規化キーが正式名称と異なる読取名（alias保存の対象）
  shipper_section: "",
  requested_at: "2026-07-11 11:00",
  confidence: "medium",
  note: null,
  lines: [
    { item_name: "冷凍サバフィレ", spec: "2kg", production_date: "2026-06-25", lot_no: "YS-2606", order_no: "", quantity: 30, unit_note: "" },
  ],
};
let ex2SlipId = 0;
{
  const r = await intakeExtraction(ex2, "verify-ex2.pdf", "fax");
  check("起票成功（荷主未確定）", r.result === "slip_created" && r.shipperName === null, r);
  ex2SlipId = r.slipId!;
  const d1 = await getSlipDetail(ex2SlipId);
  check("荷主未確定で明細保留", d1?.slip.shipper_id === null && d1?.lines[0].line_status === "hold");

  const a = await assignShipper({
    slipId: ex2SlipId, expectedVersion: d1!.slip.version, operator: "op02",
    choice: { type: "new", officialName: "山田水産株式会社", allocationRule: "fifo", productionDateManaged: true },
    rawShipperName: "ヤマダ水産(株)",
  });
  check("新規荷主で確定", a.ok === true, a);
  const d2 = await getSlipDetail(ex2SlipId);
  check("読取名が alias に保存", (d2?.shipper?.aliases ?? []).includes("ヤマダ水産(株)"), d2?.shipper);
  check("照合再実行後も未知品目は保留", d2?.lines[0].line_status === "hold");

  const rl = await resolveLine({
    slipId: ex2SlipId, lineId: d2!.lines[0].id, expectedVersion: d2!.slip.version,
    operator: "op02", choice: { type: "new" },
  });
  check("新規品目で解消", rl.ok === true, rl);

  // 倉庫は確認フォームで担当が設定する（ここではUI相当の更新を直接実行）
  await db().exec(
    "UPDATE slip_lines SET warehouse_id = 3 WHERE slip_id = :id", { id: ex2SlipId });
  const d3 = await getSlipDetail(ex2SlipId);
  const c = await confirmSlip({
    slipId: ex2SlipId, operator: "op02", expectedVersion: d3!.slip.version, allowNegative: false,
  });
  check("取込→解消→確定の一本道が通る", c.ok === true, c);
  check("在庫が生まれる", (await stockQty("lot_no = :l", { l: "YS-2606" })) === 30);
}

console.log("\n— 楽観的ロック（古いversionでの確定は競合） —");
{
  const ex3: Extraction = { ...ex2, slip_number: "YS-20260711-02", lines: ex2.lines.map((l) => ({ ...l, quantity: 5 })) };
  const r = await intakeExtraction(ex3, "verify-ex3.pdf", "fax");
  const d = await getSlipDetail(r.slipId!);
  const c = await confirmSlip({
    slipId: r.slipId!, operator: "op01", expectedVersion: d!.slip.version + 99, allowNegative: false,
  });
  check("version不一致は conflict", !c.ok && c.kind === "conflict", c);
}

console.log("\n— 在庫の手修正（理由必須＋履歴） —");
{
  const st = await db().rows<{ id: number; version: number; quantity: number }>(
    "SELECT id, version, quantity FROM stock WHERE lot_no = :l", { l: "YS-2606" });
  const bad = await adjustStock({ stockId: st[0].id, expectedVersion: st[0].version, newQuantity: 28, reason: "  ", operator: "op01" });
  check("理由なしは拒否", bad.ok === false, bad);
  const conflict = await adjustStock({ stockId: st[0].id, expectedVersion: st[0].version + 1, newQuantity: 28, reason: "棚卸差異", operator: "op01" });
  check("version不一致は拒否", conflict.ok === false, conflict);
  const good = await adjustStock({ stockId: st[0].id, expectedVersion: st[0].version, newQuantity: 28, reason: "棚卸差異（現物28）", operator: "op01" });
  check("手修正成功", good.ok === true, good);
  const logs = await db().rows(
    "SELECT * FROM edit_logs WHERE target_type = 'stock' AND target_id = :id AND action = 'adjust'",
    { id: st[0].id });
  check("履歴（いつ・誰が・何を・なぜ）が残る", logs.length === 1, logs);
}

console.log("\n— 月末確定＋表示値修正（原本不変） —");
{
  const f1 = await finalizeMonth({ month: "2026-07", operator: "op01" });
  check("月末確定成功", f1.ok === true, f1);
  const f2 = await finalizeMonth({ month: "2026-07", operator: "op01" });
  check("二重確定は拒否", f2.ok === false, f2);

  const snap = await getSnapshot("2026-07");
  check("スナップショット行あり", snap.length > 0);
  check("マイナス在庫も記録される", snap.some((s) => Number(s.quantity) < 0));

  const target = snap[0];
  const o1 = await addSnapshotOverride({
    snapshotId: target.id, overrideQuantity: Number(target.quantity) + 10,
    reason: "メーカー様帳簿との突合により", operator: "op02",
  });
  check("表示値修正成功", o1.ok === true, o1);
  const snap2 = await getSnapshot("2026-07");
  const row = snap2.find((s) => s.id === target.id)!;
  check("原本値は不変", Number(row.quantity) === Number(target.quantity));
  check("表示値は修正後", effectiveQuantity(row) === Number(target.quantity) + 10);
  const o2 = await addSnapshotOverride({
    snapshotId: target.id, overrideQuantity: effectiveQuantity(row),
    reason: "同値", operator: "op02",
  });
  check("同じ表示値への修正は拒否", o2.ok === false, o2);
}

console.log("\n— サマリー・一覧 —");
{
  const jstToday = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const summary = await getDailySummary(jstToday);
  check("本日確定分がサマリーに出る", summary.length >= 3, summary.length);
  const slips = await listSlips();
  check("伝票一覧が返る", slips.length >= 6, slips.length);
  const doneFirstIdx = slips.findIndex((s) => s.status === "done");
  const unprocessedIdx = slips.findIndex((s) => s.status === "unprocessed");
  if (unprocessedIdx >= 0 && doneFirstIdx >= 0) {
    check("未処理が完了より先に並ぶ", unprocessedIdx < doneFirstIdx);
  }
}

console.log(`\n結果: ${passed} passed / ${failed} failed`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
