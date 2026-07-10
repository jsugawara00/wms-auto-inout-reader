// 表記ゆれ照合用の正規化。DBの name_normalized と突き合わせに使う。
// 方針: 正規化は「照合キーを作る」ためだけに使い、表示は常に原文を使う。

/** 法人格の除去対象（前後どちらに付いても除去） */
const CORPORATE_SUFFIXES = [
  "株式会社",
  "有限会社",
  "合同会社",
  "合資会社",
  "合名会社",
  "(株)",
  "(有)",
  "(同)",
  "㈱",
  "㈲",
];

/** 全半角統一・空白除去の共通処理 */
function baseNormalize(input: string): string {
  return input
    .normalize("NFKC") // 全角英数・半角カナ・㈱→(株) などを統一
    .replace(/[\s　]+/g, "") // 空白（全角含む）除去
    .toLowerCase();
}

/** 荷主名の正規化：法人格・空白を除去して同一性判定キーを作る */
export function normalizeShipperName(name: string): string {
  let s = name.normalize("NFKC");
  for (const suffix of CORPORATE_SUFFIXES.map((x) => x.normalize("NFKC"))) {
    s = s.split(suffix).join("");
  }
  return baseNormalize(s);
}

/**
 * 品名・規格の正規化：
 * - 全半角・空白・大文字小文字を統一
 * - 小数の末尾ゼロを寄せる（1.80 → 1.8）。値が違うもの（1.8 と 1.85）は寄らない
 */
export function normalizeItemName(name: string): string {
  return baseNormalize(name).replace(
    /(\d+)\.(\d*?)0+(?=\D|$)/g,
    (_m, int: string, frac: string) => (frac ? `${int}.${frac}` : int)
  );
}

/** 規格も品名と同じ規則で寄せる */
export const normalizeSpec = normalizeItemName;
