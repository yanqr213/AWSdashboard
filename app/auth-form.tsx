"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function AuthForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    startTransition(() => {
      void (async () => {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email,
            password,
          }),
        });

        const payload = (await response.json()) as { ok: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          setMessage(payload.error || "操作失败。");
          return;
        }

        router.replace("/");
        router.refresh();
      })();
    });
  }

  return (
    <form className="auth-form-card" onSubmit={handleSubmit}>
      <div className="panel-header">
        <h1>登录平台</h1>
        <span className="panel-kicker">支持超级管理员和普通账号登录，账号需由管理员创建</span>
      </div>

      <label className="field-shell">
        <span>邮箱</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="power-input" placeholder="name@example.com" />
      </label>

      <label className="field-shell">
        <span>密码</span>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="power-input" placeholder="请输入密码" />
      </label>

      {message ? <div className="notice notice-warning">{message}</div> : null}

      <button type="submit" className="button-primary" disabled={isPending}>
        {isPending ? "处理中..." : "登录"}
      </button>
    </form>
  );
}
