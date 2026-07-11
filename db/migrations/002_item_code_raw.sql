-- 商品コードの読取・照合対応（FB⑤）。
-- 適用: tsx scripts/apply-sql.mts db/migrations/002_item_code_raw.sql
-- （db/schema.sql は新規構築用に同内容へ更新済み）

-- 読取そのままの商品コード（監査用・品目照合のヒント）
ALTER TABLE slip_lines ADD COLUMN IF NOT EXISTS item_code_raw VARCHAR(50) NOT NULL DEFAULT '';
