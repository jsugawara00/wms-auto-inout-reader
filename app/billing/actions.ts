"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDraftInvoice } from "@/lib/billing";
import { currentOperator, requireMasterAdmin, rememberOperator } from "@/lib/auth";

export async function createDraftAction(formData: FormData): Promise<void> {
  const shipperId = Number(formData.get("shipperId"));
  const month = String(formData.get("month") ?? "");
  const back = `/billing?month=${encodeURIComponent(month)}&shipper=${shipperId}`;

  if (!(await requireMasterAdmin())) {
    redirect(`${back}&error=${encodeURIComponent("請求書を締めるには管理者権限が必要です。")}`);
  }
  const operator = await currentOperator();
  await rememberOperator(operator);

  const result = await createDraftInvoice({ shipperId, month, operator });
  if (!result.ok) {
    redirect(`${back}&error=${encodeURIComponent(result.message)}`);
  }
  revalidatePath("/billing");
  redirect(`/billing/${result.invoiceId}?saved=${encodeURIComponent(result.message)}`);
}
