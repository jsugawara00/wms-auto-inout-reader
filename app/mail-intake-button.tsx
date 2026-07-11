"use client";

import { useFormStatus } from "react-dom";
import { runMailIntakeAction } from "./intake-actions";

// メール取込の手動実行ボタン：処理中はスピナー＋案内を表示
// （IMAP接続＋Claude読取で件数によっては数分かかるため、無反応に見せない）

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <div className="space-y-2">
      {pending && (
        <p className="flex items-center gap-2 rounded bg-blue-50 p-2 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">
          <span
            aria-hidden
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
          />
          メールを確認・読み取り中です…（件数によっては数分かかります。このままお待ちください）
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded border px-4 py-2 text-sm font-bold hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
      >
        {pending ? "取込中…" : "メールを今すぐ取り込む"}
      </button>
    </div>
  );
}

export function MailIntakeButton() {
  return (
    <form action={runMailIntakeAction}>
      <SubmitButton />
    </form>
  );
}
