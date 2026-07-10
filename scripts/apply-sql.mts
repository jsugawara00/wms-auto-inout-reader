// SQLファイルをそのまま実行する（スキーマ適用・シード投入用）。
//   npm run db:apply  → db/schema.sql
//   npm run db:seed   → db/seed.sql
// 接続先は DATABASE_URL（未設定ならローカル docker の開発用DB）。
import fs from "node:fs/promises";
import { getPool } from "../lib/db";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx scripts/apply-sql.mts <path/to/file.sql>");
  process.exit(1);
}

const sql = await fs.readFile(file, "utf-8");
const pool = getPool();
try {
  await pool.query(sql);
  console.log(`applied: ${file}`);
} finally {
  await pool.end();
}
