// 状態表示（③）：色を「文字全体」ではなく「小さなドット●」に閉じ込める。
// 画面が散らからず、スキャンしやすい。赤は「保留＝要確認」の意味だけに使い、
// 朱書き（要確認）と役割が一致するので喧嘩しない。

type DotColor = "amber" | "red" | "blue" | "green" | "neutral";

const DOT: Record<DotColor, string> = {
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  neutral: "bg-neutral-400",
};

export function StatusBadge({
  color,
  label,
  strong = false,
}: {
  color: DotColor;
  label: string;
  /** 未処理・確認中など「まだ手が要る」状態は少し強調 */
  strong?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[color]}`} aria-hidden />
      <span className={strong ? "font-medium" : "text-neutral-600 dark:text-neutral-400"}>
        {label}
      </span>
    </span>
  );
}
