import Link from "next/link";

import { UserManager } from "@/app/admin/users/manager";
import { listAccountsForAdmin, requireSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const admin = await requireSuperAdmin();
  const users = await listAccountsForAdmin();

  return (
    <main className="app-shell app-shell-wide">
      <section className="panel platform-header">
        <div className="platform-header-main">
          <div className="platform-title-row">
            <span className="eyebrow">系统管理</span>
            <span className="mode-chip mode-chip-production">超级管理员</span>
          </div>
          <h1>账号管理</h1>
          <p className="panel-copy">当前登录账号：{admin.email}。你可以新增账号、删除账号，并重置其他账号密码。</p>
        </div>
        <div className="platform-header-actions">
          <Link href="/" className="button-secondary button-link">
            返回设备平台
          </Link>
        </div>
      </section>

      <UserManager initialUsers={users} />
    </main>
  );
}
