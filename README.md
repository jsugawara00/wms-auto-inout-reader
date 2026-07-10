# 半自動 入出庫・在庫管理ツール

FAX・メールでバラバラに届く入出庫依頼を、**一つの決まった型に整え、担当者の確認を経て
在庫へ反映する**までを半自動化する、小規模倉庫（担当1〜5名）向けの軽量ツールです。

## 設計思想

- **AIは判定者ではなく補助**。読取・突合・表記ゆれ候補の提示までがAIの仕事で、
  **内容の確定は必ず入力担当**が行います。確定後の在庫責任は確定者に帰属することを、
  機能だけでなくUIの文言でも明示します。
- **判断基準はコードに書かず外出し**。荷主ごとの引き当てルール等は荷主マスタ（DB）に持ち、
  エンジンは「マスタを読んで従う」汎用のまま保ちます。
- **「起きない」ではなく「起きたときに追える・直せる」**。すべての修正は理由必須で、
  いつ・誰が・何を・なぜを完全な履歴として残します。
- **黙って捨てない・黙って登録しない・黙って上書きしない**。無関係な文書も記録・通知し、
  曖昧な品名は保留にして人へ、競合は楽観的ロックで検出します。

## 主な機能

- **取込**：依頼書PDFの画面アップロード（即時処理）／メール取込（IMAP・定期実行）。
  Claude API による構造化読取（信頼境界：本文中の命令文は指示として実行しない）。
- **二重読込防止**：伝票番号＋明細の指紋（SHA-256）で同一依頼の再取込を弾く。
- **確認フォーム**：荷主・品目の表記ゆれ照合、保留の関門と解消、修正（理由必須）、
  楽観的ロック＋編集中表示、確定（責任帰属の明示）。
- **在庫反映**：FIFO／荷主指定ロット。実在庫を割る出庫は担当承認制（マイナス在庫警告）。
- **レポート**：日次の入出庫サマリー（最後の砦）、荷主グループの在庫一覧、在庫の手修正。
- **月末確定**：月末残高のスナップショット確定（＝翌月期首）。原本は不変。
  **表示値修正**（現場要件）：メーカー帳簿との突合による確定後の数値合わせを、
  原本を変えず表示レイヤーで受け止め、全履歴を残す（印刷は修正後の値のみ）。
- **マスタ管理**：荷主マスタ（引き当てルール・製造日管理・特殊例外・別名）、
  商品マスタ（商品コード・単価・表記ゆれ品目の統合マージ）。
- **権限**：admin（マスタ登録可＝その場確定）／operator（保留＋登録依頼通知）。

## 技術構成

| 領域 | 採用 |
|---|---|
| フロント／アプリ | TypeScript + Next.js（App Router） |
| DB | PostgreSQL（本番は Neon）・生SQL（ORM不使用） |
| 認証・権限 | Clerk（未設定時は担当者コード方式で動作） |
| ファイル保管 | Vercel Blob（PDF原本の監査保管） |
| 定期実行 | Vercel Cron（メール取込・夕方1回/日） |
| 読取 | Claude API（PDF直読・構造化出力） |
| 通知 | Slack Webhook |

## セットアップ（ローカル開発）

```bash
# 1. 依存をインストール
npm install

# 2. ローカル Postgres を起動（docker）
docker compose up -d

# 3. 環境変数を用意（.env.example を参照）
cp .env.example .env.local   # DATABASE_URL は docker のデフォルトで動きます

# 4. スキーマ適用＋デモシード投入
npm run db:apply
npm run db:seed

# 5. 開発サーバー
npm run dev   # http://localhost:3000
```

環境変数（`.env.example` 参照）。未設定でも動く項目が多く、段階的に有効化できます。

- `DATABASE_URL`（必須）: Postgres 接続文字列。
- `ANTHROPIC_API_KEY`: PDF・メール本文の読取に使用。
- `BLOB_READ_WRITE_TOKEN`: Vercel Blob（PDF原本の保管）。未設定なら保管をスキップ。
- `SLACK_WEBHOOK_URL`: 通知。未設定なら通知をスキップ。
- `GMAIL_USER` / `GMAIL_APP_PASSWORD` / `GMAIL_INTAKE_ALIAS`: メール取込（IMAP）。
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`: 認証。未設定なら担当者コード方式。
- `CRON_SECRET`: Vercel Cron の認可トークン。
- `APP_BASE_URL`: 通知リンクの起点。

## 検証

```bash
npm run typecheck        # 型チェック
npm run verify:core      # コアパイプライン（取込〜確定〜在庫〜月末）の検証
npm run verify:masters   # マスタ管理（CRUD・統合マージ）の検証
```

## デプロイ（Vercel）

1. Vercel Marketplace から **Neon Postgres** を追加（`DATABASE_URL` が自動設定）。
   Neon のSQLエディタ等で `db/schema.sql` を適用。デモ用に `db/seed.sql` も投入可。
2. **Vercel Blob** を追加（`BLOB_READ_WRITE_TOKEN`）。
3. **Clerk**（任意）を追加し、ユーザーの `publicMetadata` に
   `{ "operatorCode": "op01", "role": "admin" }` を設定。
4. `ANTHROPIC_API_KEY` ほか必要な環境変数を設定。
5. デプロイ。メール取込は `vercel.json` の Cron 設定により毎日実行されます。
