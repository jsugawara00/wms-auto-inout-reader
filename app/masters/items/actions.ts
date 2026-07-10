"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createItem, updateItem, mergeItems } from "@/lib/masters";
import { currentOperator, requireMasterAdmin, rememberOperator } from "@/lib/auth";

function parsePrice(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  return Number(t);
}

export async function createItemAction(formData: FormData): Promise<void> {
  if (!(await requireMasterAdmin())) {
    redirect(`/masters/items?error=${encodeURIComponent("商品マスタの登録には管理者権限が必要です。")}`);
  }
  const operator = await currentOperator();
  await rememberOperator(operator);
  const result = await createItem({
    shipperId: Number(formData.get("shipperId")),
    name: String(formData.get("name") ?? ""),
    spec: String(formData.get("spec") ?? ""),
    itemCode: String(formData.get("itemCode") ?? ""),
    unitPrice: parsePrice(String(formData.get("unitPrice") ?? "")),
    operator,
  });
  revalidatePath("/masters/items");
  redirect(
    `/masters/items?${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}

export async function updateItemAction(formData: FormData): Promise<void> {
  if (!(await requireMasterAdmin())) {
    redirect(`/masters/items?error=${encodeURIComponent("商品マスタの編集には管理者権限が必要です。")}`);
  }
  const operator = await currentOperator();
  await rememberOperator(operator);
  const result = await updateItem({
    itemId: Number(formData.get("itemId")),
    name: String(formData.get("name") ?? ""),
    spec: String(formData.get("spec") ?? ""),
    itemCode: String(formData.get("itemCode") ?? ""),
    unitPrice: parsePrice(String(formData.get("unitPrice") ?? "")),
    operator,
  });
  revalidatePath("/masters/items");
  redirect(
    `/masters/items?${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}

export async function mergeItemsAction(formData: FormData): Promise<void> {
  if (!(await requireMasterAdmin())) {
    redirect(`/masters/items?error=${encodeURIComponent("品目の統合には管理者権限が必要です。")}`);
  }
  const operator = await currentOperator();
  await rememberOperator(operator);
  const sourceItemId = Number(formData.get("sourceItemId"));
  const targetItemId = Number(formData.get("targetItemId"));
  if (!Number.isInteger(targetItemId)) {
    redirect(`/masters/items?error=${encodeURIComponent("統合先の品目を選択してください。")}`);
  }
  const result = await mergeItems({ sourceItemId, targetItemId, operator });
  revalidatePath("/masters/items");
  revalidatePath("/stock");
  redirect(
    `/masters/items?${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}
