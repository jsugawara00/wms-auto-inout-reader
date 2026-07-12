import Link from "next/link";

export const metadata = { title: "使い方ガイド — 入出庫・在庫管理" };

// 使用説明書（1-19）。長文にせず、フロー図＋カードで「誰が見ても分かる」。
// あわせて「そこまでできるの?」の現場機能をアピールする（説明兼サービス紹介）。

const FLOW = [
  { icon: "📥", label: "届く", note: "FAX（PDF）・メールで依頼が届く" },
  { icon: "🤖", label: "読む", note: "AIが内容を読み取る（補助）" },
  { icon: "👀", label: "確認", note: "担当者が内容を確認・修正" },
  { icon: "✅", label: "確定", note: "確定すると在庫へ反映" },
  { icon: "📦", label: "在庫", note: "FIFO・指定ロットで引き当て" },
  { icon: "📊", label: "サマリー", note: "その日の入出庫を一覧で再確認" },
  { icon: "🗓️", label: "月末", note: "月末残高を確定・印刷" },
  { icon: "🧾", label: "請求", note: "保管料・作業料を計算して発行" },
];

const PROMISES = [
  {
    icon: "🧭",
    title: "AIは補助、確定は人間",
    body: "読み取りや候補の提示まではAIがやりますが、最終的な内容の確定は必ず担当者が行います。確定後の責任は確定した人に帰属します。",
    accent: "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950",
  },
  {
    icon: "🚫",
    title: "黙って捨てない・登録しない・上書きしない",
    body: "迷ったものは保留にして人へ回します。入出庫と無関係な文書も記録して通知。勝手に新規登録したり上書きしたりしません。",
    accent: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
  },
  {
    icon: "🔎",
    title: "「起きない」ではなく「追える・直せる」",
    body: "ミスをゼロにするのではなく、起きたときに追えて直せることを重視。すべての修正に理由と履歴（いつ・誰が・何を・なぜ）が残ります。",
    accent: "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950",
  },
];

const STEPS = [
  {
    n: 1,
    icon: "📄",
    title: "依頼書をアップロード",
    body: "トップ画面の「ここを押して依頼書PDFを選ぶ」からアップロード。メールで届く分は自動で取り込まれます。",
  },
  {
    n: 2,
    icon: "👀",
    title: "確認フォームで確認",
    body: "「伝票（確認フォーム）」に届きます。荷主・品目・数量・入出庫日を確認し、必要なら修正（理由を書くと履歴に残ります）。",
  },
  {
    n: 3,
    icon: "✅",
    title: "確定 → あとは各画面へ",
    body: "「確定する」で在庫へ反映。入出庫サマリー・在庫一覧・月末確定・請求は、それぞれの画面から。",
  },
];

const WISDOM = [
  {
    icon: "🗓️",
    title: "読み込みを忘れても大丈夫",
    body: "記録は「実際に物が動いた日（出荷日・入荷日）」が基準。翌日に処理しても、昨日の出荷は昨日の記録になります。「なんで忘れた」と言われないための仕組みです。",
  },
  {
    icon: "🩹",
    title: "月末表の「貼り絵」をデジタルに",
    body: "メーカーの入力漏れで「月初にマイナスして」と言われても、確定した原本は変えず、表示の値だけ直して印刷。原本と修正の両方が履歴に残ります。",
  },
  {
    icon: "🧾",
    title: "例外の請求も1枚に",
    body: "保管料・作業料のほかに臨時で発生した請求も、別のExcelを作らず、請求書に1行足すだけ。フローがバラけません。",
  },
  {
    icon: "🧩",
    title: "コード探しゼロ",
    body: "依頼書に商品コードがあれば自動で品目に紐付け。品名の表記ゆれ（1.8＝1.80 など）も寄せます。人が探すのは例外だけ。",
  },
  {
    icon: "⚠️",
    title: "危ないところだけ赤で教える",
    body: "在庫を割る出庫・値の食い違い・読めない箇所は朱書き＋確認を求めます。それ以外は素通しで速い。注意を向けるべき場所だけに人の時間を使えます。",
  },
];

export default function GuidePage() {
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">使い方ガイド</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          バラバラに届く入出庫依頼を、<strong>一つの型に整え → 担当者の確認を経て → 在庫・請求へ</strong>
          反映するツールです。むずかしい操作はありません。まずは全体の流れから。
        </p>
      </header>

      {/* 全体の流れ */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold">① 全体の流れ</h2>
        <div className="overflow-x-auto">
          <div className="flex min-w-max items-stretch gap-2">
            {FLOW.map((f, i) => (
              <div key={f.label} className="flex items-center gap-2">
                <div className="w-28 rounded-lg border border-neutral-200 bg-white p-3 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="text-2xl" aria-hidden>{f.icon}</div>
                  <div className="mt-1 font-bold">{f.label}</div>
                  <div className="mt-1 text-xs text-neutral-500">{f.note}</div>
                </div>
                {i < FLOW.length - 1 && (
                  <span className="text-xl text-neutral-300 dark:text-neutral-600" aria-hidden>→</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3つの約束 */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold">② このツールの3つの約束</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {PROMISES.map((p) => (
            <div key={p.title} className={`space-y-1 rounded-lg border p-4 ${p.accent}`}>
              <div className="text-2xl" aria-hidden>{p.icon}</div>
              <h3 className="font-bold">{p.title}</h3>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 使い方3ステップ */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold">③ 使い方は3ステップ</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                  {s.n}
                </span>
                <span className="text-xl" aria-hidden>{s.icon}</span>
                <h3 className="font-bold">{s.title}</h3>
              </div>
              <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 現場の知恵 */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold">④ 「そこまでできるの?」— 現場の知恵</h2>
          <p className="text-sm text-neutral-500">
            倉庫の現場で本当に困る場面を、正面から機能にしています。ここが他にはない部分です。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {WISDOM.map((w) => (
            <div key={w.title} className="flex gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="text-2xl" aria-hidden>{w.icon}</div>
              <div>
                <h3 className="font-bold">{w.title}</h3>
                <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{w.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-neutral-600 dark:text-neutral-400">
          各画面のボタンの近くにも短い説明があります。まずは
          <Link href="/" className="mx-1 text-blue-600 underline dark:text-blue-400">ダッシュボード</Link>
          から依頼書をアップロードしてみてください。
        </p>
      </section>
    </div>
  );
}
