-- 請求書の「締め → 確認フォーム → 発行（印刷可）」への拡張（1-15 / 1-16）。
-- 適用: tsx scripts/apply-sql.mts db/migrations/005_invoice_confirm.sql
-- （db/schema.sql は新規構築用に同内容へ更新済み）

-- 請求書の状態: draft=確認中（調整・例外行の追加が可能）/ issued=発行済（不変・印刷可）
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft','issued'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issued_by VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issued_at TIMESTAMP;
-- 既存データ（従来は即確定＝発行済み相当）は issued 扱いにする
UPDATE invoices SET status = 'issued', issued_by = finalized_by, issued_at = finalized_at
  WHERE status = 'draft';

-- 明細に例外行（manual）を許可
ALTER TABLE invoice_lines DROP CONSTRAINT invoice_lines_category_check;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_category_check
  CHECK (category IN ('storage','handling_in','handling_out','manual'));

-- 表示調整層（原本 amount は不変、adjusted_amount が表示値。NULL=無調整）
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS adjusted_amount NUMERIC(14,0);
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS adjust_reason TEXT;
