import { cookies } from "next/headers";
import { currentOperator } from "./auth";

// デモゲスト（配布用アカウント）の読取回数ガード（企画書 9 / API濫用防止・個人開発のコスト保護）。
// 本番は Clerk 施錠で守るが、就活・営業のファーストコンタクト向けに配布するデモアカウントは
// 誰でも触れるため、読取回数に上限を設ける。
//
// カウント単位：「読取＝Claude API 1回」＝アップロードした PDF 1件（重複除外はAPI呼び出しの後なので
//   処理ファイル数＝API回数）。上限に達したら読取自体を止める。
// ゲスト判定：担当者コードが GUEST_OPERATOR_CODES（既定 "guest"）に一致する場合のみ。
//   実ユーザー（op01 等）・ローカル開発（既定 op01）は無制限のまま影響を受けない。
//   ローカルでも担当者コードを "guest" に切り替えれば挙動を確認できる。
// 記録：Cookie（httpOnly・サーバー側で enforce）。
//   ※Cookie 削除でリセットは可能＝厳密な総量制限ではない。デモの「お願い」ラインの防御としては十分。
//   より強固にするなら IP／DB での日次上限を検討（商品版・本運用向け）。

const COOKIE = "wms_guest_reads";
const DEFAULT_LIMIT = 5; // 入庫3＋出庫2の想定

/** デモゲストの読取上限（既定5）。env GUEST_MAX_READS_PER_SESSION で調整可。 */
export function guestReadLimit(): number {
  const n = Number(process.env.GUEST_MAX_READS_PER_SESSION);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_LIMIT;
}

/** ゲスト扱いにする担当者コード（既定 "guest"）。カンマ区切りで複数指定可。 */
function guestOperatorCodes(): string[] {
  return (process.env.GUEST_OPERATOR_CODES ?? "guest")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** 現在の担当者がデモゲストか。 */
export async function isGuest(): Promise<boolean> {
  const op = (await currentOperator()).trim().toLowerCase();
  return guestOperatorCodes().includes(op);
}

/** これまでに消費した読取回数（Cookie）。 */
async function usedReads(): Promise<number> {
  const store = await cookies();
  const n = Number(store.get(COOKIE)?.value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** 残り読取回数。ゲストでなければ null（＝無制限）。 */
export async function remainingGuestReads(): Promise<number | null> {
  if (!(await isGuest())) return null;
  return Math.max(0, guestReadLimit() - (await usedReads()));
}

/** 読取を count 回分消費して記録（ゲストのときのみ意味を持つ）。Server Action 内で呼ぶ。 */
export async function consumeGuestReads(count: number): Promise<void> {
  if (count <= 0 || !(await isGuest())) return;
  const store = await cookies();
  store.set(COOKIE, String((await usedReads()) + count), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30, // 30日
  });
}
