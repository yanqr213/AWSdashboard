"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="button-secondary nav-logout-button"
      onClick={() => {
        startTransition(() => {
          void (async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            router.replace("/login");
            router.refresh();
          })();
        });
      }}
    >
      {isPending ? "退出中..." : "退出登录"}
    </button>
  );
}
