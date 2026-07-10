import { SignInButton, UserButton } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth";

// Clerk 有効時のみログイン/ユーザーボタンを表示。
// 未設定（デモ）ではダッシュボードの担当者切替が代わりを務めるため何も出さない。
export async function AuthControls() {
  if (!clerkEnabled()) return null;
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  return (
    <span className="ml-auto flex items-center gap-3 text-xs">
      {userId ? (
        <UserButton />
      ) : (
        <SignInButton mode="modal">
          <button className="rounded border px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            ログイン
          </button>
        </SignInButton>
      )}
    </span>
  );
}
