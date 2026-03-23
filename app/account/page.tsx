import Link from "next/link";

import styles from "@/app/console.module.css";
import { PasswordForm } from "@/app/account/password-form";
import { requireAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireAuthenticatedUser();

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <div className={styles.heroMain}>
            <span className={styles.eyebrow}>Account</span>
            <h1 className={styles.heroTitle}>我的账号</h1>
            <p className={styles.heroCopy}>普通用户只能修改自己的密码；管理员新增账号、重置其他账号密码请前往账号管理。</p>
          </div>
          <div className={styles.heroActions}>
            <span className={`${styles.modeChip} ${user.role === "super-admin" ? styles.modeChipLive : styles.modeChipMuted}`}>
              {user.role === "super-admin" ? "超级管理员" : "普通账号"}
            </span>
            {user.role === "super-admin" ? (
              <Link href="/admin/users" className="button-secondary button-link">
                去账号管理
              </Link>
            ) : null}
            <Link href="/" className="button-secondary button-link">
              返回设备列表
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>密码设置</h2>
            <p className={styles.sectionCopy}>当前登录账号：{user.email}</p>
          </div>
        </div>
        <PasswordForm />
      </section>
    </main>
  );
}
