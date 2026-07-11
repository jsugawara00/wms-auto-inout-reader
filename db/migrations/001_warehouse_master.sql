-- 倉庫マスタ管理画面の追加（FB③）に伴う変更。
-- 適用: tsx scripts/apply-sql.mts db/migrations/001_warehouse_master.sql
-- （db/schema.sql は新規構築用に同内容へ更新済み）

-- 倉庫の登録・修正を履歴（edit_logs）に残せるよう target_type に warehouse を追加
ALTER TABLE edit_logs DROP CONSTRAINT edit_logs_target_type_check;
ALTER TABLE edit_logs ADD CONSTRAINT edit_logs_target_type_check
  CHECK (target_type IN ('stock','slip','slip_line','item','shipper','snapshot','warehouse'));

-- 倉庫マスタの updated_at 自動更新（既存 warehouses テーブルに追加）
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT jst_now();
CREATE TRIGGER trg_warehouses_updated BEFORE UPDATE ON warehouses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
