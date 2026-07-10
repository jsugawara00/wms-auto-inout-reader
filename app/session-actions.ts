"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { rememberOperator, setRole, type Role } from "@/lib/auth";

// 担当者コード・ロールの切替（Clerk 導入前のデモ用セッション操作）。
// Clerk 導入後は Clerk 側のユーザー属性が正となり、この操作は不要になる。

export async function switchSessionAction(formData: FormData): Promise<void> {
  const operator = String(formData.get("operator") ?? "").trim();
  const role = String(formData.get("role") ?? "admin") === "operator" ? "operator" : "admin";
  if (operator) await rememberOperator(operator);
  await setRole(role as Role);
  revalidatePath("/");
  redirect(`/?intake=${encodeURIComponent(`担当者 ${operator || "（変更なし）"} ／ ロール ${role} に切り替えました。`)}`);
}
