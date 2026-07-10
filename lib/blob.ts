import { put } from "@vercel/blob";

// PDF原本の監査保管（Vercel Blob・アクセス制御あり）。
// - 取込時にアップロードし、伝票の source_file に URL を保持する
// - BLOB_READ_WRITE_TOKEN 未設定（ローカル検証等）では保管をスキップし null を返す。
//   保管失敗でも取込自体は止めない（原本はメール/紙側にも残る）

export async function storePdf(
  filename: string,
  pdf: Buffer
): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const blob = await put(`slips/${Date.now()}-${filename}`, pdf, {
      access: "public",
      contentType: "application/pdf",
      addRandomSuffix: true,
    });
    return blob.url;
  } catch {
    return null;
  }
}
