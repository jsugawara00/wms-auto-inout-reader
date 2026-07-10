import { cookies } from "next/headers";

// 認証・権限（企画書 9 最小権限 / 仕様候補§荷主確定の設計）
// ロール2種：admin（マスタ登録可＝その場確定）／operator（保留＋登録依頼通知）。
//
// ここは Clerk 導入前のフォールバック実装（担当者コード＋ロールを Cookie で保持）。
// Clerk 導入時はこのモジュールだけ差し替えれば全画面・全アクションが追従する
// （逃げ道：Clerkで詰まってもこの担当者コード方式でデプロイできる）。
// 担当者コード（operators.code）は監査表示の可読性のため常に維持する。

export type Role = "admin" | "operator";

const OPERATOR_COOKIE = "wms_operator";
const ROLE_COOKIE = "wms_role";

/** 現在の担当者コード（未設定時はデモ担当 op01） */
export async function currentOperator(): Promise<string> {
  const store = await cookies();
  return store.get(OPERATOR_COOKIE)?.value?.trim() || "op01";
}

/** 担当者コードを記憶（サーバーアクション内でのみ呼べる） */
export async function rememberOperator(code: string): Promise<void> {
  if (!code.trim()) return;
  const store = await cookies();
  store.set(OPERATOR_COOKIE, code.trim(), { path: "/", sameSite: "lax" });
}

/**
 * 現在のロール。小規模現場は実質全員 admin（＝その場確定で試作と同じ最速UX）。
 * デモで operator の挙動を確認できるよう Cookie で切替可能にしている。
 */
export async function currentRole(): Promise<Role> {
  const store = await cookies();
  return store.get(ROLE_COOKIE)?.value === "operator" ? "operator" : "admin";
}

export async function setRole(role: Role): Promise<void> {
  const store = await cookies();
  store.set(ROLE_COOKIE, role, { path: "/", sameSite: "lax" });
}

/** マスタ登録（その場確定）権限を持つか */
export async function requireMasterAdmin(): Promise<boolean> {
  return (await currentRole()) === "admin";
}
