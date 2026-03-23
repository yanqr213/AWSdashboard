"use client";

import { useState, useTransition } from "react";

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "warning">("warning");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (nextPassword !== confirmPassword) {
      setMessageTone("warning");
      setMessage("两次输入的新密码不一致。");
      return;
    }

    setMessage(null);

    startTransition(() => {
      void (async () => {
        const response = await fetch("/api/auth/password", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            currentPassword,
            nextPassword,
          }),
        });

        const payload = (await response.json()) as { ok: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          setMessageTone("warning");
          setMessage(payload.error || "修改密码失败。");
          return;
        }

        setCurrentPassword("");
        setNextPassword("");
        setConfirmPassword("");
        setMessageTone("success");
        setMessage("密码已更新。");
      })();
    });
  }

  return (
    <form className="auth-form-card" onSubmit={handleSubmit}>
      <div className="panel-header">
        <h2>修改我的密码</h2>
        <span className="panel-kicker">仅允许修改当前登录账号的密码</span>
      </div>

      <label className="field-shell">
        <span>当前密码</span>
        <input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          className="power-input"
          placeholder="请输入当前密码"
        />
      </label>

      <label className="field-shell">
        <span>新密码</span>
        <input
          type="password"
          value={nextPassword}
          onChange={(event) => setNextPassword(event.target.value)}
          className="power-input"
          placeholder="至少 8 位"
        />
      </label>

      <label className="field-shell">
        <span>确认新密码</span>
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="power-input"
          placeholder="再次输入新密码"
        />
      </label>

      {message ? <div className={`notice ${messageTone === "success" ? "notice-success" : "notice-warning"}`}>{message}</div> : null}

      <button type="submit" className="button-primary" disabled={isPending}>
        {isPending ? "处理中..." : "更新密码"}
      </button>
    </form>
  );
}
