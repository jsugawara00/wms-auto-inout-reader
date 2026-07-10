-- ============================================================
-- デモ用シードデータ（空のDBに1回だけ実行する）
-- 架空3荷主＋商品。実データ・実在の荷主情報は含まない。
-- シナリオ:
--   伝票1: マルノウ食品 出庫400（FIFO：2ロットまたぎ引き当て）
--   伝票2: 北洋水産 出庫50（荷主指定ロット）
--   伝票3: 東部資材 入庫20（製造日管理なし）
--   伝票4: 北洋水産 出庫100（在庫80 → マイナス在庫警告のデモ）
-- ============================================================

INSERT INTO warehouses (id, code, name, warehouse_type) VALUES
  (1, 'W1', '第一倉庫（常温）', 'normal'),
  (2, 'W2', '第二倉庫（冷蔵）', 'chilled'),
  (3, 'W3', '第三倉庫（冷凍）', 'frozen');

INSERT INTO operators (id, code, name) VALUES
  (1, 'op01', '担当者A'),
  (2, 'op02', '担当者B');

-- name_normalized は lib/normalize.ts の normalizeShipperName と同じ規則。
-- 引き当てルール・製造日管理有無・特殊例外は shippers テーブルが正（旧 rules/*.md を移設）。
INSERT INTO shippers
  (id, name, name_normalized, aliases, allocation_rule, production_date_managed,
   exceptions_note, section, phone, fax, email) VALUES
  (1, 'マルノウ食品株式会社', 'マルノウ食品',
   '["マルノウ食品(株)", "(株)マルノウ食品", "マルノウ食品"]',
   'fifo', true,
   E'- 賞味期限残り90日を切ったロットは出庫前に荷主へ電話確認（システムは警告表示のみ、判断は入力担当）。\n- 同一製造日で袋サイズ違い（1kg / 500g）が併存するため、規格の読取に注意。',
   '業務用食品部', '06-1234-5678', '06-1234-5679', 'juchu@marunou-foods.example.co.jp'),
  (2, '北洋水産株式会社', '北洋水産',
   '["北洋水産(株)", "ホクヨウ水産"]',
   'lot_specified', true,
   E'- 出庫は必ず荷主指定ロット。依頼書にロット（製造日）記載が無い場合は保留にして荷主へ確認。\n- 指定ロットが実在庫に無い場合も保留（FIFOへの自動振替はしない）。',
   '冷凍事業部', '011-333-4444', '011-333-4445', 'reizo@hokuyo-suisan.example.co.jp'),
  (3, '東部資材株式会社', '東部資材',
   '["東部資材(株)", "東部資材"]',
   'fifo', false,
   E'- 製造日管理なし（非食品）。在庫は品名×規格単位で集約。\n- パレット単位（1PL=40ケース）で依頼が来ることがある。数量単位の読取に注意。',
   '資材課', '047-111-2222', '047-111-2223', 'butsuryu@toubu-shizai.example.co.jp');

INSERT INTO items (id, shipper_id, name, spec, name_normalized, item_code, unit_price) VALUES
  (1, 1, '冷凍コロッケ', '1kg', '冷凍コロッケ', 'MN-CRQ-1000', 480.00),
  (2, 1, '冷凍コロッケ', '500g', '冷凍コロッケ', 'MN-CRQ-0500', 260.00),
  (3, 2, '冷凍ホタテ貝柱', '500g', '冷凍ホタテ貝柱', 'HK-SCL-0500', 1450.00),
  (4, 3, '養生シート', '1.8m', '養生シート', 'TS-SHT-1800', NULL);

INSERT INTO stock (warehouse_id, item_id, production_date, lot_no, order_no, quantity) VALUES
  (2, 1, '2026-06-01', '', '', 300.000),        -- マルノウ コロッケ1kg（古）
  (2, 1, '2026-06-20', '', '', 500.000),        -- マルノウ コロッケ1kg（新）
  (3, 3, '2026-05-15', 'HK-2605', '', 120.000), -- 北洋 ホタテ（指定ロット対象）
  (3, 3, '2026-06-10', 'HK-2606', '', 80.000),
  (1, 4, NULL, '', '', 40.000);                 -- 東部 養生シート（製造日管理なし）

INSERT INTO slips
  (id, slip_type, source_type, slip_number, fingerprint, status, shipper_id,
   requested_at, received_at, confidence, note) VALUES
  (1, 'outbound', 'fax', 'MN-20260709-01', encode(sha256('seed-slip-1'::bytea), 'hex'),
   'unprocessed', 1, '2026-07-09 09:15:00', '2026-07-09 17:00:00', 'high', NULL),
  (2, 'outbound', 'fax', 'HK-20260709-11', encode(sha256('seed-slip-2'::bytea), 'hex'),
   'unprocessed', 2, '2026-07-09 10:40:00', '2026-07-09 17:00:00', 'high', NULL),
  (3, 'inbound', 'mail', 'TS-20260710-03', encode(sha256('seed-slip-3'::bytea), 'hex'),
   'unprocessed', 3, '2026-07-10 08:05:00', '2026-07-10 08:30:00', 'medium',
   'メール本文の数量表記が「1PL」。1PL=40ケース換算か要確認（荷主マスタの特殊例外参照）'),
  (4, 'outbound', 'fax', 'HK-20260710-02', encode(sha256('seed-slip-4'::bytea), 'hex'),
   'unprocessed', 2, '2026-07-10 09:00:00', '2026-07-10 09:20:00', 'high', NULL);

INSERT INTO slip_lines
  (slip_id, line_no, item_name_raw, spec_raw, item_id, warehouse_id,
   production_date, lot_no, order_no, quantity) VALUES
  -- 伝票1: FIFO出庫（在庫 300+500 に対して 400 → 2ロットまたぎ）
  (1, 1, '冷凍コロッケ', '1kg', 1, 2, NULL, '', '', 400.000),
  -- 伝票2: 指定ロット出庫
  (2, 1, '冷凍ホタテ貝柱', '500g', 3, 3, '2026-05-15', 'HK-2605', '', 50.000),
  -- 伝票3: 入庫（製造日管理なし荷主）
  (3, 1, '養生シート', '1.8m', 4, 1, NULL, '', '', 20.000),
  -- 伝票4: 指定ロット出庫だが在庫不足（80に対し100）→ マイナス警告デモ
  (4, 1, '冷凍ホタテ貝柱', '500g', 3, 3, '2026-06-10', 'HK-2606', '', 100.000);

-- 明示IDで投入したテーブルの採番を進める
SELECT setval(pg_get_serial_sequence('warehouses', 'id'), (SELECT MAX(id) FROM warehouses));
SELECT setval(pg_get_serial_sequence('operators', 'id'), (SELECT MAX(id) FROM operators));
SELECT setval(pg_get_serial_sequence('shippers', 'id'), (SELECT MAX(id) FROM shippers));
SELECT setval(pg_get_serial_sequence('items', 'id'), (SELECT MAX(id) FROM items));
SELECT setval(pg_get_serial_sequence('slips', 'id'), (SELECT MAX(id) FROM slips));
