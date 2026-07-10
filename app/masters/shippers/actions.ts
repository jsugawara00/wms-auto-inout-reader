"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createShipper, updateShipper, type ShipperInput } from "@/lib/masters";
import { currentOperator, requireMasterAdmin, rememberOperator } from "@/lib/auth";
import type { AllocationRule } from "@/lib/types";

function parseAliases(raw: string): string[] {
  return raw
    .split(/[\n,、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function readInput(formData: FormData, operator: string): Promise<ShipperInput> {
  return {
    name: String(formData.get("name") ?? ""),
    aliases: parseAliases(String(formData.get("aliases") ?? "")),
    allocationRule:
      String(formData.get("allocationRule")) === "lot_specified"
        ? ("lot_specified" as AllocationRule)
        : ("fifo" as AllocationRule),
    productionDateManaged: formData.get("productionDateManaged") === "on",
    exceptionsNote: String(formData.get("exceptionsNote") ?? ""),
    section: String(formData.get("section") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    fax: String(formData.get("fax") ?? ""),
    email: String(formData.get("email") ?? ""),
    operator,
  };
}

export async function createShipperAction(formData: FormData): Promise<void> {
  if (!(await requireMasterAdmin())) {
    redirect(`/masters/shippers?error=${encodeURIComponent("荷主マスタの登録には管理者権限が必要です。")}`);
  }
  const operator = await currentOperator();
  await rememberOperator(operator);
  const result = await createShipper(await readInput(formData, operator));
  revalidatePath("/masters/shippers");
  redirect(
    `/masters/shippers?${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}

export async function updateShipperAction(formData: FormData): Promise<void> {
  if (!(await requireMasterAdmin())) {
    redirect(`/masters/shippers?error=${encodeURIComponent("荷主マスタの編集には管理者権限が必要です。")}`);
  }
  const shipperId = Number(formData.get("shipperId"));
  const operator = await currentOperator();
  await rememberOperator(operator);
  const result = await updateShipper(shipperId, await readInput(formData, operator));
  revalidatePath("/masters/shippers");
  redirect(
    `/masters/shippers?${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}
