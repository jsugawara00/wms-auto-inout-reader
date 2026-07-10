"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { finalizeMonth, addSnapshotOverride } from "@/lib/closing";
import { currentOperator, rememberOperator } from "@/lib/auth";

export async function finalizeMonthAction(formData: FormData): Promise<void> {
  const month = String(formData.get("month") ?? "");
  const operator = await currentOperator();
  const acknowledged = formData.get("acknowledged") === "on";

  if (!acknowledged) {
    redirect(
      `/closing?error=${encodeURIComponent("確定文言への同意チェックが必要です（確定後の月末表は不変です）。")}`
    );
  }
  await rememberOperator(operator);

  const result = await finalizeMonth({ month, operator });
  revalidatePath("/closing");
  redirect(
    result.ok
      ? `/closing?month=${encodeURIComponent(month)}&saved=${encodeURIComponent(result.message)}`
      : `/closing?error=${encodeURIComponent(result.message)}`
  );
}

export async function overrideSnapshotAction(formData: FormData): Promise<void> {
  const month = String(formData.get("month") ?? "");
  const snapshotId = Number(formData.get("snapshotId"));
  const overrideQuantity = Number(formData.get("overrideQuantity"));
  const reason = String(formData.get("reason") ?? "");
  const operator = await currentOperator();
  await rememberOperator(operator);

  const back = `/closing?month=${encodeURIComponent(month)}`;
  const result = await addSnapshotOverride({ snapshotId, overrideQuantity, reason, operator });
  revalidatePath("/closing");
  redirect(
    `${back}&${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}
