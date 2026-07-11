import { cookies } from "next/headers";

// 認証・権限（企画書 9 最小権限 / 仕様候補§荷主確定の設計）
// ロール2種：admin（マスタ登録可＝その場確定）／operator（保留＋登録依頼通知）。
//
// 二段構え：
//  - CLERK_SECRET_KEY が設定されていれば Clerk のログインユーザーを正とする
//    （担当者コード＝publicMetadata.operatorCode／ロール＝publicMetadata.role）。
//  - 未設定なら担当者コード＋ロールを Cookie で保持するフォールバック
//    （逃げ道：Clerkで詰まってもデプロイできる。デモも鍵なしで動く）。
// 担当者コード（operators.code）は監査表示の可読性のため常に維持する。

export type Role = "admin" | "operator";

const OPERATOR_COOKIE = "wms_operator";
const ROLE_COOKIE = "wms_role";

export function clerkEnabled(): boolean {
  return !!process.env.CLERK_SECRET_KEY;
}

/** Clerk のセッションから担当者コードとロールを読む（未ログイン・未設定は null） */
async function clerkIdentity(): Promise<{ operator: string; role: Role } | null> {
  if (!clerkEnabled()) return null;
  try {
    const { auth, currentUser } = await import("@clerk/nextjs/server");
    const { sessionClaims, userId } = await auth();
    if (!userId) return null;
    // セッショントークンに metadata が載っていればそれを使い、
    // 無ければユーザー情報（publicMetadata）を直接読む（Clerk側の追加設定を不要にする）
    let meta = (sessionClaims?.metadata ?? {}) as { operatorCode?: string; role?: string };
    if (!meta.operatorCode && !meta.role) {
      const user = await currentUser();
      meta = (user?.publicMetadata ?? {}) as { operatorCode?: string; role?: string };
    }
    return {
      operator: meta.operatorCode?.trim() || `clerk:${userId.slice(-6)}`,
      role: meta.role === "operator" ? "operator" : "admin",
    };
  } catch {
    return null;
  }
}

/** 現在の担当者コード */
export async function currentOperator(): Promise<string> {
  const id = await clerkIdentity();
  if (id) return id.operator;
  const store = await cookies();
  return store.get(OPERATOR_COOKIE)?.value?.trim() || "op01";
}

/** 担当者コードを記憶（Cookieフォールバック時のみ意味を持つ。サーバーアクション内で呼ぶ） */
export async function rememberOperator(code: string): Promise<void> {
  if (!code.trim() || clerkEnabled()) return;
  const store = await cookies();
  store.set(OPERATOR_COOKIE, code.trim(), { path: "/", sameSite: "lax" });
}

/**
 * 現在のロール。小規模現場は実質全員 admin（＝その場確定で試作と同じ最速UX）。
 * デモで operator の挙動を確認できるよう Cookie で切替可能にしている。
 */
export async function currentRole(): Promise<Role> {
  const id = await clerkIdentity();
  if (id) return id.role;
  const store = await cookies();
  return store.get(ROLE_COOKIE)?.value === "operator" ? "operator" : "admin";
}

export async function setRole(role: Role): Promise<void> {
  if (clerkEnabled()) return;
  const store = await cookies();
  store.set(ROLE_COOKIE, role, { path: "/", sameSite: "lax" });
}

/** マスタ登録（その場確定）権限を持つか */
export async function requireMasterAdmin(): Promise<boolean> {
  return (await currentRole()) === "admin";
}
