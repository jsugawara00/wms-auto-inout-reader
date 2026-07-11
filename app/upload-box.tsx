"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { uploadPdfAction } from "./intake-actions";

// PDFアップロード（FB①②）：
// - 大きなクリック領域（点線ボックス）で「ここを押して選ぶ」を明示
// - 送信中はスピナー＋「読み取り中…」を表示（Claude読取に数十秒かかるため）

function SubmitArea({ fileCount }: { fileCount: number }) {
  const { pending } = useFormStatus();
  return (
    <div className="space-y-2">
      {pending && (
        <p className="flex items-center gap-2 rounded bg-blue-50 p-2 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">
          <span
            aria-hidden
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
          />
          読み取り中です…（1件あたり数十秒かかります。このままお待ちください）
        </p>
      )}
      <button
        type="submit"
        disabled={pending || fileCount === 0}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending
          ? "読み取り中…"
          : fileCount > 0
            ? `${fileCount}件のPDFをアップロードして取込`
            : "アップロードして取込"}
      </button>
    </div>
  );
}

export function UploadBox() {
  const [fileNames, setFileNames] = useState<string[]>([]);

  return (
    <form action={uploadPdfAction} className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/50 px-4 py-8 text-center transition-colors hover:border-blue-500 hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 dark:hover:border-blue-600">
        <input
          type="file"
          name="pdfs"
          accept="application/pdf"
          multiple
          className="sr-only"
          onChange={(e) =>
            setFileNames(Array.from(e.currentTarget.files ?? []).map((f) => f.name))
          }
        />
        <span aria-hidden className="text-3xl">
          📄
        </span>
        <span className="font-bold text-blue-700 dark:text-blue-300">
          ここを押して依頼書PDFを選ぶ
        </span>
        <span className="text-xs text-neutral-500">
          クリックしてファイルを選択（複数選択できます）
        </span>
      </label>

      {fileNames.length > 0 && (
        <ul className="space-y-0.5 text-xs text-neutral-600 dark:text-neutral-400">
          {fileNames.map((n) => (
            <li key={n}>✓ {n}</li>
          ))}
        </ul>
      )}

      <SubmitArea fileCount={fileNames.length} />
    </form>
  );
}
