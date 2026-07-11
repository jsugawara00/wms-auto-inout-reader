// 一時診断：本日のメール取込ログを一覧（精査用・後で削除）
import { getPool, db } from "../lib/db";

const rows = await db().rows<{
  id: number;
  source_type: string;
  source_ref: string;
  result: string;
  slip_id: number | null;
  note: string | null;
  created_at: string;
}>(
  `SELECT id, source_type, source_ref, result, slip_id, note, created_at
   FROM intake_logs
   WHERE source_type = 'mail'
   ORDER BY id`
);
for (const r of rows) {
  console.log(`[${r.created_at}] ${r.result}${r.slip_id ? ` → 伝票#${r.slip_id}` : ""}`);
  console.log(`  取込元: ${r.source_ref}`);
  if (r.note) console.log(`  メモ: ${r.note}`);
}
console.log(`\n合計: ${rows.length}件`);
await getPool().end();
