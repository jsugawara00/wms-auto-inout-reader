"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adjustStock } from "@/lib/stock-adjust";
import { currentOperator, rememberOperator } from "@/lib/auth";

export async function adjustStockAction(formData: FormData): Promise<void> {
  const stockId = Number(formData.get("stockId"));
  const expectedVersion = Number(formData.get("stockVersion"));
  const newQuantity = Number(formData.get("newQuantity"));
  const reason = String(formData.get("reason") ?? "");
  const operator = await currentOperator();
  await rememberOperator(operator);

  const result = await adjustStock({ stockId, expectedVersion, newQuantity, reason, operator });

  revalidatePath("/stock");
  redirect(
    `/stock?${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}
