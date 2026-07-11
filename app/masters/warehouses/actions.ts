"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createWarehouse, updateWarehouse } from "@/lib/masters";
import { currentOperator, requireMasterAdmin, rememberOperator } from "@/lib/auth";
import type { Warehouse } from "@/lib/types";

function parseType(raw: string): Warehouse["warehouse_type"] {
  return raw === "chilled" || raw === "frozen" ? raw : "normal";
}

export async function createWarehouseAction(formData: FormData): Promise<void> {
  if (!(await requireMasterAdmin())) {
    redirect(`/masters/warehouses?error=${encodeURIComponent("倉庫マスタの登録には管理者権限が必要です。")}`);
  }
  const operator = await currentOperator();
  await rememberOperator(operator);
  const result = await createWarehouse({
    code: String(formData.get("code") ?? ""),
    name: String(formData.get("name") ?? ""),
    warehouseType: parseType(String(formData.get("warehouseType") ?? "")),
    operator,
  });
  revalidatePath("/masters/warehouses");
  redirect(
    `/masters/warehouses?${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}

export async function updateWarehouseAction(formData: FormData): Promise<void> {
  if (!(await requireMasterAdmin())) {
    redirect(`/masters/warehouses?error=${encodeURIComponent("倉庫マスタの編集には管理者権限が必要です。")}`);
  }
  const operator = await currentOperator();
  await rememberOperator(operator);
  const result = await updateWarehouse({
    warehouseId: Number(formData.get("warehouseId")),
    code: String(formData.get("code") ?? ""),
    name: String(formData.get("name") ?? ""),
    warehouseType: parseType(String(formData.get("warehouseType") ?? "")),
    operator,
  });
  revalidatePath("/masters/warehouses");
  redirect(
    `/masters/warehouses?${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}
