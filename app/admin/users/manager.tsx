"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { SafeAuthUser } from "@/lib/auth";

type UserManagerProps = {
  initialUsers: SafeAuthUser[];
};

export function UserManager({ initialUsers }: UserManagerProps) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function refreshUsers() {
    const response = await fetch("/api/admin/users");
    const payload = (await response.json()) as { ok: boolean; users?: SafeAuthUser[]; error?: string };
    if (payload.ok && payload.users) {
      setUsers(payload.users);
      return true;
    }

    setMessage(payload.error || "刷新账号列表失败。");
    return false;
  }

  function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    startTransition(() => {
      void (async () => {
        const response = await fetch("/api/admin/users", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email,
            password,
            role: "user",
          }),
        });
        const payload = (await response.json()) as { ok: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          setMessage(payload.error || "创建账号失败。");
          return;
        }

        setEmail("");
        setPassword("");
        await refreshUsers();
        router.refresh();
      })();
    });
  }

  function handleResetPassword(userId: string) {
    const nextPassword = window.prompt("请输入新密码");
    if (!nextPassword) {
      return;
    }

    setMessage(null);
    startTransition(() => {
      void (async () => {
        const response = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            userId,
            password: nextPassword,
          }),
        });
        const payload = (await response.json()) as { ok: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          setMessage(payload.error || "修改密码失败。");
          return;
        }

        setMessage("密码已更新。");
        await refreshUsers();
      })();
    });
  }

  function handleDelete(userId: string) {
    if (!window.confirm("确定删除这个账号吗？")) {
      return;
    }

    setMessage(null);
    startTransition(() => {
      void (async () => {
        const response = await fetch("/api/admin/users", {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            userId,
          }),
        });
        const payload = (await response.json()) as { ok: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          setMessage(payload.error || "删除账号失败。");
          return;
        }

        await refreshUsers();
        router.refresh();
      })();
    });
  }

  return (
    <section className="dashboard-grid dashboard-grid-uneven">
      <section className="panel">
        <div className="panel-header">
          <h2>新增账号</h2>
          <span className="panel-kicker">默认创建普通账号</span>
        </div>
        <form className="auth-form-card auth-form-inline" onSubmit={handleCreate}>
          <label className="field-shell">
            <span>邮箱</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="power-input" placeholder="user@example.com" />
          </label>
          <label className="field-shell">
            <span>初始密码</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="power-input" placeholder="至少 8 位" />
          </label>
          {message ? <div className="notice notice-warning">{message}</div> : null}
          <button type="submit" className="button-primary" disabled={isPending}>
            {isPending ? "处理中..." : "添加账号"}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>账号列表</h2>
          <span className="panel-kicker">{users.length} 个账号</span>
        </div>
        <div className="table-shell">
          <table className="quec-table">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>角色</th>
                <th>创建时间</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>{user.role === "super-admin" ? "超级管理员" : "普通账号"}</td>
                  <td>{user.createdAt.slice(0, 19).replace("T", " ")}</td>
                  <td>{user.updatedAt.slice(0, 19).replace("T", " ")}</td>
                  <td className="admin-user-actions">
                    <button type="button" className="table-link table-link-button" onClick={() => handleResetPassword(user.id)}>
                      修改密码
                    </button>
                    <button type="button" className="table-link table-link-button danger-link" onClick={() => handleDelete(user.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
