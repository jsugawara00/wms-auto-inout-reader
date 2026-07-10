// Slack 通知（企画書 6.1/6.2/7）
// - 届いています通知／要確認通知／無関係文書の通知（黙って捨てない）
// - SLACK_WEBHOOK_URL 未設定なら何もしない（開発環境で邪魔をしない）
// - 通知は補助であり、失敗しても業務処理（取込・確定）は止めない

export async function notifySlack(text: string): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch {
    // 通知失敗で本処理を止めない（ログは呼び出し側の責務）
    return false;
  }
}
