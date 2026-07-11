"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { upsertTariff } from "@/lib/billing";
import { currentOperator, requireMasterAdmin, rememberOperator } from "@/lib/auth";

function parseRate(raw: string): number {
  const t = raw.trim();
  return t === "" ? 0 : Number(t);
}

export async function saveTariffAction(formData: FormData): Promise<void> {
  if (!(await requireMasterAdmin())) {
    redirect(`/masters/tariffs?error=${encodeURIComponent("タリフの登録・編集には管理者権限が必要です。")}`);
  }
  const operator = await currentOperator();
  await rememberOperator(operator);

  const shipperId = Number(formData.get("shipperId"));
  const target = String(formData.get("target") ?? ""); // "default" or item id
  const itemId = target === "default" ? null : Number(target);
  if (!Number.isInteger(shipperId)) {
    redirect(`/masters/tariffs?error=${encodeURIComponent("荷主を選択してください。")}`);
  }
  if (target !== "default" && !Number.isInteger(itemId)) {
    redirect(`/masters/tariffs?shipper=${shipperId}&error=${encodeURIComponent("対象（荷主既定または品目）を選択してください。")}`);
  }

  const result = await upsertTariff({
    shipperId,
    itemId,
    storageRate: parseRate(String(formData.get("storageRate") ?? "")),
    handlingInRate: parseRate(String(formData.get("handlingInRate") ?? "")),
    handlingOutRate: parseRate(String(formData.get("handlingOutRate") ?? "")),
    note: String(formData.get("note") ?? ""),
    operator,
  });
  revalidatePath("/masters/tariffs");
  redirect(
    `/masters/tariffs?shipper=${shipperId}&${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}
