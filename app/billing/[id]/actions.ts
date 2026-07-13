"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  adjustInvoiceLine,
  addManualLine,
  deleteManualLine,
  recomputeDraft,
  issueInvoice,
  reopenInvoice,
} from "@/lib/billing";
import { currentOperator, requireMasterAdmin, rememberOperator } from "@/lib/auth";

async function guardAdmin(invoiceId: number): Promise<string> {
  if (!(await requireMasterAdmin())) {
    redirect(`/billing/${invoiceId}?error=${encodeURIComponent("この操作には管理者権限が必要です。")}`);
  }
  const operator = await currentOperator();
  await rememberOperator(operator);
  return operator;
}

function back(invoiceId: number, result: { ok: boolean; message: string }) {
  redirect(
    `/billing/${invoiceId}?${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}

export async function adjustLineAction(formData: FormData): Promise<void> {
  const invoiceId = Number(formData.get("invoiceId"));
  const operator = await guardAdmin(invoiceId);
  const result = await adjustInvoiceLine({
    lineId: Number(formData.get("lineId")),
    adjustedAmount: Number(formData.get("adjustedAmount")),
    reason: String(formData.get("reason") ?? ""),
    operator,
  });
  revalidatePath(`/billing/${invoiceId}`);
  back(invoiceId, result);
}

export async function addManualLineAction(formData: FormData): Promise<void> {
  const invoiceId = Number(formData.get("invoiceId"));
  const operator = await guardAdmin(invoiceId);
  const result = await addManualLine({
    invoiceId,
    itemName: String(formData.get("itemName") ?? ""),
    spec: String(formData.get("spec") ?? ""),
    quantity: Number(formData.get("quantity")),
    unitPrice: Number(formData.get("unitPrice")),
    operator,
  });
  revalidatePath(`/billing/${invoiceId}`);
  back(invoiceId, result);
}

export async function deleteManualLineAction(formData: FormData): Promise<void> {
  const invoiceId = Number(formData.get("invoiceId"));
  const operator = await guardAdmin(invoiceId);
  const result = await deleteManualLine({
    lineId: Number(formData.get("lineId")),
    operator,
  });
  revalidatePath(`/billing/${invoiceId}`);
  back(invoiceId, result);
}

export async function recomputeAction(formData: FormData): Promise<void> {
  const invoiceId = Number(formData.get("invoiceId"));
  const operator = await guardAdmin(invoiceId);
  const result = await recomputeDraft({ invoiceId, operator });
  revalidatePath(`/billing/${invoiceId}`);
  back(invoiceId, result);
}

export async function issueAction(formData: FormData): Promise<void> {
  const invoiceId = Number(formData.get("invoiceId"));
  const operator = await guardAdmin(invoiceId);
  if (formData.get("acknowledged") !== "on") {
    redirect(`/billing/${invoiceId}?error=${encodeURIComponent("発行の確認チェックが必要です。")}`);
  }
  const result = await issueInvoice({ invoiceId, operator });
  revalidatePath(`/billing/${invoiceId}`);
  revalidatePath("/billing");
  back(invoiceId, result);
}

export async function reopenAction(formData: FormData): Promise<void> {
  const invoiceId = Number(formData.get("invoiceId"));
  const operator = await guardAdmin(invoiceId);
  const result = await reopenInvoice({
    invoiceId,
    reason: String(formData.get("reason") ?? ""),
    operator,
  });
  revalidatePath(`/billing/${invoiceId}`);
  revalidatePath("/billing");
  back(invoiceId, result);
}
