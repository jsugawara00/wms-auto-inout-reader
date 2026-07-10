"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTransaction } from "@/lib/db";
import { confirmSlip, type NegativeWarning } from "@/lib/inventory";
import { currentOperator, rememberOperator, requireMasterAdmin } from "@/lib/auth";
import { notifySlack } from "@/lib/notify";
import type { Slip, SlipLine, AllocationRule } from "@/lib/types";

// ---------------------------------------------------------------
// 明細の修正（手修正は理由必須・履歴記録：企画書 6.7）
// ---------------------------------------------------------------
export async function saveLineAction(formData: FormData): Promise<void> {
  const slipId = Number(formData.get("slipId"));
  const lineId = Number(formData.get("lineId"));
  const expectedVersion = Number(formData.get("slipVersion"));
  const operator = await currentOperator();
  const reason = String(formData.get("reason") ?? "").trim();

  const redirectTo = (msg: string, isError: boolean) =>
    redirect(`/slips/${slipId}?${isError ? "error" : "saved"}=${encodeURIComponent(msg)}`);

  if (!reason) redirectTo("修正理由は必須です（いつ・誰が・何を・なぜ、の「なぜ」）。", true);
  await rememberOperator(operator);

  const updates = {
    warehouse_id: formData.get("warehouseId") ? Number(formData.get("warehouseId")) : null,
    production_date: String(formData.get("productionDate") ?? "") || null,
    lot_no: String(formData.get("lotNo") ?? "").trim(),
    order_no: String(formData.get("orderNo") ?? "").trim(),
    quantity: Number(formData.get("quantity")),
    site_reported_quantity:
      String(formData.get("siteReportedQuantity") ?? "").trim() === ""
        ? null
        : Number(formData.get("siteReportedQuantity")),
  };
  if (!Number.isFinite(updates.quantity) || updates.quantity <= 0) {
    redirectTo("数量は正の数で入力してください。", true);
  }

  const error = await withTransaction(async (conn): Promise<string | null> => {
    const slips = await conn.rows<Slip>(
      "SELECT * FROM slips WHERE id = :slipId FOR UPDATE",
      { slipId }
    );
    const slip = slips[0];
    if (!slip) return "伝票が見つかりません。";
    if (slip.status === "done") return "確定済みの伝票は修正できません（在庫の手修正は在庫画面から）。";
    if (slip.version !== expectedVersion) {
      return "他の担当者がこの伝票を更新しました。最新表示を確認してから修正してください。";
    }
    const lineRows = await conn.rows<SlipLine>(
      "SELECT * FROM slip_lines WHERE id = :lineId AND slip_id = :slipId",
      { lineId, slipId }
    );
    const line = lineRows[0];
    if (!line) return "明細が見つかりません。";

    const changes: Array<{ field: string; oldValue: string; newValue: string }> = [];
    const track = (field: keyof typeof updates, oldVal: unknown, newVal: unknown) => {
      const o = oldVal === null || oldVal === undefined ? "" : String(oldVal);
      const n = newVal === null || newVal === undefined ? "" : String(newVal);
      if (o !== n) changes.push({ field, oldValue: o, newValue: n });
    };
    track("warehouse_id", line.warehouse_id, updates.warehouse_id);
    track("production_date", line.production_date, updates.production_date);
    track("lot_no", line.lot_no, updates.lot_no);
    track("order_no", line.order_no, updates.order_no);
    track("quantity", line.quantity, updates.quantity);
    track("site_reported_quantity", line.site_reported_quantity, updates.site_reported_quantity);

    if (changes.length === 0) return "変更点がありません。";

    await conn.exec(
      `UPDATE slip_lines SET
         warehouse_id = :warehouse_id, production_date = :production_date,
         lot_no = :lot_no, order_no = :order_no, quantity = :quantity,
         site_reported_quantity = :site_reported_quantity
       WHERE id = :lineId`,
      { ...updates, lineId }
    );
    await conn.exec("UPDATE slips SET version = version + 1 WHERE id = :slipId", { slipId });
    for (const c of changes) {
      await conn.exec(
        `INSERT INTO edit_logs (target_type, target_id, action, field, old_value, new_value, reason, operator)
         VALUES ('slip_line', :lineId, 'update', :field, :oldValue, :newValue, :reason, :operator)`,
        { lineId, ...c, reason, operator }
      );
    }
    return null;
  });

  revalidatePath(`/slips/${slipId}`);
  if (error) redirectTo(error, true);
  redirectTo("明細を修正しました（履歴に記録済み）。", false);
}

// ---------------------------------------------------------------
// 荷主の確定（既存へ紐付け／新規登録：企画書 6.5）
// マスタ登録権限（admin）が必要。operator は「登録を依頼」で管理者へ通知する。
// ---------------------------------------------------------------
export async function assignShipperAction(formData: FormData): Promise<void> {
  const slipId = Number(formData.get("slipId"));
  const expectedVersion = Number(formData.get("slipVersion"));
  const operator = await currentOperator();
  const choiceRaw = String(formData.get("choice") ?? "");
  const rawShipperName = String(formData.get("rawShipperName") ?? "") || undefined;

  const admin = await requireMasterAdmin();
  if (!admin) {
    redirect(
      `/slips/${slipId}?error=${encodeURIComponent("荷主マスタの登録・確定には管理者権限が必要です。「マスタ登録を依頼」から管理者へ通知してください。")}`
    );
  }
  await rememberOperator(operator);
  const { assignShipper } = await import("@/lib/shipper-assign");

  const choice =
    choiceRaw === "new"
      ? ({
          type: "new",
          officialName: String(formData.get("officialName") ?? ""),
          allocationRule:
            String(formData.get("allocationRule")) === "lot_specified"
              ? ("lot_specified" as AllocationRule)
              : ("fifo" as AllocationRule),
          productionDateManaged: formData.get("productionDateManaged") === "on",
          section: String(formData.get("section") ?? "").trim() || undefined,
          exceptionsNote: String(formData.get("exceptionsNote") ?? "").trim() || undefined,
        } as const)
      : ({ type: "existing", shipperId: Number(choiceRaw) } as const);

  if (choice.type === "existing" && !Number.isInteger(choice.shipperId)) {
    redirect(
      `/slips/${slipId}?error=${encodeURIComponent("既存荷主を選ぶか「新規荷主として登録」を選択してください。")}`
    );
  }

  const result = await assignShipper({ slipId, expectedVersion, operator, choice, rawShipperName });

  revalidatePath(`/slips/${slipId}`);
  redirect(
    `/slips/${slipId}?${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}

// ---------------------------------------------------------------
// マスタ登録の依頼（権限のない operator → 管理者へ Slack 通知：仕様候補§荷主確定の設計）
// ---------------------------------------------------------------
export async function requestShipperRegistrationAction(formData: FormData): Promise<void> {
  const slipId = Number(formData.get("slipId"));
  const rawShipperName = String(formData.get("rawShipperName") ?? "").trim();
  const operator = await currentOperator();
  await rememberOperator(operator);

  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  await notifySlack(
    `📝 荷主マスタの登録依頼\n担当 ${operator} が伝票 #${slipId} の荷主登録を依頼しました（読取名: ${rawShipperName || "―"}）。\n登録はこちら： ${base}/slips/${slipId}`
  );

  redirect(
    `/slips/${slipId}?saved=${encodeURIComponent("管理者へマスタ登録を依頼しました。登録され次第、品目照合が自動で再実行されます。")}`
  );
}

// ---------------------------------------------------------------
// 保留明細の解消（既存品目へ寄せる／新規品目として登録：企画書 6.4）
// ---------------------------------------------------------------
export async function resolveLineAction(formData: FormData): Promise<void> {
  const slipId = Number(formData.get("slipId"));
  const lineId = Number(formData.get("lineId"));
  const expectedVersion = Number(formData.get("slipVersion"));
  const operator = await currentOperator();
  const choiceRaw = String(formData.get("choice") ?? "");
  const note = String(formData.get("note") ?? "").trim() || undefined;

  // 新規品目の登録はマスタ登録権限（admin）が必要。既存へ寄せるのは誰でも可。
  if (choiceRaw === "new") {
    const admin = await requireMasterAdmin();
    if (!admin) {
      redirect(
        `/slips/${slipId}?error=${encodeURIComponent("新規品目の登録には管理者権限が必要です。既存品目へ寄せるか、管理者へ登録を依頼してください。")}`
      );
    }
  }
  await rememberOperator(operator);

  const { resolveLine } = await import("@/lib/resolve");
  const choice =
    choiceRaw === "new"
      ? ({ type: "new" } as const)
      : ({ type: "existing", itemId: Number(choiceRaw) } as const);

  if (choice.type === "existing" && !Number.isInteger(choice.itemId)) {
    redirect(
      `/slips/${slipId}?error=${encodeURIComponent("既存品目を選ぶか「新規品目として登録」を選択してください。")}`
    );
  }

  const result = await resolveLine({ slipId, lineId, expectedVersion, operator, choice, note });

  revalidatePath(`/slips/${slipId}`);
  redirect(
    `/slips/${slipId}?${result.ok ? `saved=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`}`
  );
}

// ---------------------------------------------------------------
// 保留 / 保留解除
// ---------------------------------------------------------------
export async function holdSlipAction(formData: FormData): Promise<void> {
  const slipId = Number(formData.get("slipId"));
  const expectedVersion = Number(formData.get("slipVersion"));
  const operator = await currentOperator();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    redirect(`/slips/${slipId}?error=${encodeURIComponent("保留理由は必須です。")}`);
  }
  await rememberOperator(operator);

  const error = await withTransaction(async (conn): Promise<string | null> => {
    const slips = await conn.rows<Slip>(
      "SELECT * FROM slips WHERE id = :slipId FOR UPDATE",
      { slipId }
    );
    const slip = slips[0];
    if (!slip) return "伝票が見つかりません。";
    if (slip.status !== "unprocessed") return `「${slip.status}」の伝票は保留にできません。`;
    if (slip.version !== expectedVersion) return "他の担当者が更新済みです。最新表示を確認してください。";
    await conn.exec(
      `UPDATE slips SET status = 'hold', hold_reason = :reason, version = version + 1 WHERE id = :slipId`,
      { reason, slipId }
    );
    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
       VALUES ('slip', :slipId, 'hold', :reason, :operator)`,
      { slipId, reason, operator }
    );
    return null;
  });

  revalidatePath(`/slips/${slipId}`);
  redirect(
    `/slips/${slipId}?${error ? `error=${encodeURIComponent(error)}` : `saved=${encodeURIComponent("保留にしました。")}`}`
  );
}

export async function releaseSlipAction(formData: FormData): Promise<void> {
  const slipId = Number(formData.get("slipId"));
  const expectedVersion = Number(formData.get("slipVersion"));
  const operator = await currentOperator();
  await rememberOperator(operator);

  const error = await withTransaction(async (conn): Promise<string | null> => {
    const slips = await conn.rows<Slip>(
      "SELECT * FROM slips WHERE id = :slipId FOR UPDATE",
      { slipId }
    );
    const slip = slips[0];
    if (!slip) return "伝票が見つかりません。";
    if (slip.status !== "hold") return "保留中の伝票ではありません。";
    if (slip.version !== expectedVersion) return "他の担当者が更新済みです。最新表示を確認してください。";
    await conn.exec(
      `UPDATE slips SET status = 'unprocessed', hold_reason = NULL, version = version + 1 WHERE id = :slipId`,
      { slipId }
    );
    await conn.exec(
      `INSERT INTO edit_logs (target_type, target_id, action, reason, operator)
       VALUES ('slip', :slipId, 'release', '保留解除', :operator)`,
      { slipId, operator }
    );
    return null;
  });

  revalidatePath(`/slips/${slipId}`);
  redirect(
    `/slips/${slipId}?${error ? `error=${encodeURIComponent(error)}` : `saved=${encodeURIComponent("保留を解除しました。")}`}`
  );
}

// ---------------------------------------------------------------
// 確定（入力担当の関門：企画書 6.2）
// ---------------------------------------------------------------
export interface ConfirmFormState {
  status: "idle" | "error" | "negative";
  message?: string;
  warnings?: NegativeWarning[];
}

export async function confirmSlipFormAction(
  _prev: ConfirmFormState,
  formData: FormData
): Promise<ConfirmFormState> {
  const slipId = Number(formData.get("slipId"));
  const expectedVersion = Number(formData.get("slipVersion"));
  const operator = await currentOperator();
  const acknowledged = formData.get("acknowledged") === "on";
  const allowNegative = formData.get("allowNegative") === "true";

  if (!operator) return { status: "error", message: "担当者コードが取得できません。ログインを確認してください。" };
  if (!acknowledged) {
    return {
      status: "error",
      message: "確定文言への同意チェックが必要です（確定後の在庫責任は確定者に帰属します）。",
    };
  }
  await rememberOperator(operator);

  const result = await confirmSlip({ slipId, operator, expectedVersion, allowNegative });
  if (!result.ok) {
    if (result.kind === "negative") {
      return { status: "negative", warnings: result.warnings };
    }
    return { status: "error", message: result.message };
  }

  revalidatePath("/slips");
  revalidatePath("/stock");
  redirect(`/slips/${slipId}?saved=${encodeURIComponent("確定し、在庫へ反映しました。")}`);
}
