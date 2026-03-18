"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type AuthFormProps = {
  mode: "login" | "register";
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState(mode === "login" ? "qirui.yan@yituishui.cn" : "");
  const [password, setPassword] = useState(mode === "login" ? "y11531752" : "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    startTransition(() => {
      void (async () => {
        const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
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

        if (mode === "login") {
          router.replace("/");
          router.refresh();
          return;
        }

        setMessage("注册成功，请使用新账号登录。");
        setPassword("");
      })();
    });
  }

  return (
    <form className="auth-form-card" onSubmit={handleSubmit}>
      <div className="panel-header">
        <h1>{mode === "login" ? "登录平台" : "注册账号"}</h1>
        <span className="panel-kicker">{mode === "login" ? "支持超级管理员和普通账号登录" : "注册后默认是普通账号"}</span>
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
        {isPending ? "处理中..." : mode === "login" ? "登录" : "注册"}
      </button>

      <div className="auth-form-links">
        {mode === "login" ? (
          <Link href="/register" className="button-secondary button-link">
            去注册
          </Link>
        ) : (
          <Link href="/login" className="button-secondary button-link">
            去登录
          </Link>
        )}
      </div>
    </form>
  );
}
