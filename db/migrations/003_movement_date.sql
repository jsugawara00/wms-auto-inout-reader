-- 入出庫日（movement_date）の導入（FB⑥）。
-- 書類上の出荷日・入荷日＝実際に商品が倉庫を出入りする日。サマリーの基準日になる。
-- 適用: tsx scripts/apply-sql.mts db/migrations/003_movement_date.sql
-- （db/schema.sql は新規構築用に同内容へ更新済み）

ALTER TABLE slips ADD COLUMN IF NOT EXISTS movement_date DATE;

-- 既存伝票の補完：確定済みは実際に反映した日、未確定は依頼日→取込日の順で埋める
UPDATE slips
SET movement_date = COALESCE(confirmed_at::date, requested_at::date, received_at::date)
WHERE movement_date IS NULL;
