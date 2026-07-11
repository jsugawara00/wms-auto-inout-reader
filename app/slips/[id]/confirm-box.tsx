"use client";

import { useActionState } from "react";
import { confirmSlipFormAction, type ConfirmFormState } from "../actions";

const initialState: ConfirmFormState = { status: "idle" };

export function ConfirmBox(props: { slipId: number; slipVersion: number; operator: string }) {
  const [state, formAction, pending] = useActionState(confirmSlipFormAction, initialState);
  const negative = state.status === "negative";
  const dateMismatch = state.status === "date_mismatch";
  // 入出庫日不一致の承認は、一度警告を見たら以降の再送信で維持する
  const allowDate = dateMismatch || state.acknowledgedDate === true;

  return (
    <form
      action={formAction}
      className="space-y-3 rounded border border-neutral-300 p-4 dark:border-neutral-700"
    >
      <h2 className="font-bold">確定</h2>
      <input type="hidden" name="slipId" value={props.slipId} />
      <input type="hidden" name="slipVersion" value={props.slipVersion} />
      {/* 各警告後の再送信時のみ true になる */}
      <input type="hidden" name="allowNegative" value={negative ? "true" : "false"} />
      <input type="hidden" name="allowDateMismatch" value={allowDate ? "true" : "false"} />

      {state.status === "error" && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.message}
        </p>
      )}

      {dateMismatch && (
        <div className="rounded border border-amber-500 bg-amber-50 p-3 text-sm dark:bg-amber-950">
          <p className="font-bold text-amber-800 dark:text-amber-300">
            入出庫日が本日ではありません
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">{state.message}</p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            処理する場合のみ、再度「確定する」を押してください。
          </p>
        </div>
      )}

      {negative && (
        <div className="rounded border border-red-400 bg-red-50 p-3 text-sm dark:bg-red-950">
          <p className="font-bold text-red-700 dark:text-red-300">
            実在庫を超えます。処理しますか？
          </p>
          <ul className="mt-1 list-disc pl-5 text-red-700 dark:text-red-300">
            {state.warnings?.map((w) => (
              <li key={w.lineNo}>
                明細{w.lineNo}: {w.itemName} — 依頼 {w.requested} に対し在庫 {w.available}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-red-700 dark:text-red-300">
            このまま確定すると在庫がマイナスになります。現物・依頼内容を確認のうえ、処理する場合のみ再度「確定する」を押してください。
          </p>
        </div>
      )}

      <p className="text-sm text-neutral-500">
        担当者：<span className="font-mono">{props.operator}</span>
      </p>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="acknowledged" className="mt-1" />
        <span>
          この内容で確定します。<strong>確定後の在庫責任は確定者に帰属</strong>することを理解しています。
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending
          ? "処理中…"
          : negative || dateMismatch
            ? "警告を理解のうえ確定する"
            : "確定する"}
      </button>
    </form>
  );
}
