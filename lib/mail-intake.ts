import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { extractSlipFromText } from "./extract";
import { intakeExtraction, intakePdf, type IntakeResult } from "./intake";

// メール取込（企画書 6.1 STEP2）— Vercel Cron（夕方1日1回）＋手動実行ボタンから呼ばれる
// - Gmail の未読メールを IMAP（アプリパスワード）で取得
// - ⚠ 個人メールを巻き込まないよう「特定アドレス宛（+エイリアス）」のみ処理する
//   （企画書 6.1「特定アドレス宛の依頼」。既定: <user>+wms@gmail.com）
// - PDF添付 → その場で取込（Blob保管＋読取＋起票。FAXアップロードと同じ経路）
// - 添付なし本文のみ → 本文から直接読取して起票（無関係メールも記録＝黙って捨てない）
// - 処理したメールは既読化し「WMS-processed」フォルダへ退避

const PROCESSED_MAILBOX = "WMS-processed";

/** 取込対象アドレス（宛先がこれを含むメールだけ処理する） */
function intakeAlias(user: string): string {
  if (process.env.GMAIL_INTAKE_ALIAS) return process.env.GMAIL_INTAKE_ALIAS;
  const [local, domain] = user.split("@");
  return `${local}+wms@${domain}`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
}

export interface MailIntakeResult {
  results: IntakeResult[];
}

/** Gmail の未読メールを取り込む。GMAIL_USER/GMAIL_APP_PASSWORD 未設定なら null */
export async function fetchMailIntake(): Promise<MailIntakeResult | null> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!user || !pass) return null;

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const results: IntakeResult[] = [];

  await client.connect();
  try {
    // 退避先フォルダ（無ければ作成。既存エラーは無視）
    try {
      await client.mailboxCreate(PROCESSED_MAILBOX);
    } catch {
      // already exists
    }

    const alias = intakeAlias(user);
    const lock = await client.getMailboxLock("INBOX");
    try {
      // 未読 かつ 専用アドレス宛のみ（個人メールには触れない）
      const found = await client.search({ seen: false, to: alias }, { uid: true });
      const uids = Array.isArray(found) ? found : [];
      for (const uid of uids) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const subject = parsed.subject ?? "(件名なし)";
        const from = parsed.from?.text ?? "(差出人不明)";

        const pdfs = (parsed.attachments ?? []).filter(
          (a) =>
            a.contentType === "application/pdf" ||
            (a.filename ?? "").toLowerCase().endsWith(".pdf")
        );

        if (pdfs.length > 0) {
          // PDF添付 → FAXアップロードと同じ経路で取込（企画書 6.1「同じ型へ集約」）
          for (let i = 0; i < pdfs.length; i++) {
            const base = sanitizeFilename(pdfs[i].filename ?? `attachment-${i + 1}.pdf`);
            results.push(await intakePdf(pdfs[i].content, `mail-${uid}-${base}`, "mail"));
          }
        } else {
          // 本文のみ → 自然文から抽出（まず動かし段階的に精度向上：企画書 STEP2）
          // 送信日時も渡す：「翌日集荷」等の相対日付を絶対日付へ換算する基準になる（FB⑦）
          const bodyText = (parsed.text ?? "").trim();
          const sentAt = parsed.date
            ? new Date(parsed.date.getTime() + 9 * 60 * 60 * 1000)
                .toISOString()
                .slice(0, 16)
                .replace("T", " ")
            : null;
          const sourceRef = `mail: ${subject}（${from}）`;
          const mailText = `件名: ${subject}\n差出人: ${from}${sentAt ? `\n送信日時: ${sentAt}（JST）` : ""}\n\n${bodyText}`;
          const ex = await extractSlipFromText(mailText);
          results.push(await intakeExtraction(ex, sourceRef, "mail"));
        }

        // 処理済み退避（既読化＋フォルダ移動）
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        await client.messageMove(uid, PROCESSED_MAILBOX, { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return { results };
}
