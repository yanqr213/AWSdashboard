import Link from "next/link";

import styles from "@/app/console.module.css";
import { UserManager } from "@/app/admin/users/manager";
import { listAccountsForAdmin, requireSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const admin = await requireSuperAdmin();
  const users = await listAccountsForAdmin();

  return (
    <main className={`${styles.page} ${styles.pageWide}`}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <div className={styles.heroMain}>
            <span className={styles.eyebrow}>Admin</span>
            <h1 className={styles.heroTitle}>账号管理</h1>
            <p className={styles.heroCopy}>当前登录账号：{admin.email}。这里只有管理员能新增账号、删除账号和重置其他账号密码。</p>
          </div>
          <div className={styles.heroActions}>
            <span className={`${styles.modeChip} ${styles.modeChipLive}`}>超级管理员</span>
            <Link href="/" className="button-secondary button-link">
              返回设备列表
            </Link>
          </div>
        </div>
      </section>

      <UserManager initialUsers={users} />

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>推荐角色方案</h2>
            <p className={styles.sectionCopy}>先按客服、售后和管理员三层拆分，后续再按经销商或区域权限细化。</p>
          </div>
        </div>

        <div className={styles.detailSummaryGrid}>
          <article className={styles.detailSummaryCard}>
            <span>超级管理员</span>
            <strong>全量权限</strong>
            <em>账号管理、环境配置、导出、服务工具、所有设备详情和历史。</em>
          </article>
          <article className={styles.detailSummaryCard}>
            <span>客服</span>
            <strong>查阅 + 诊断</strong>
            <em>设备列表、详情、历史曲线、服务工具、复制沟通摘要；不允许账号管理和敏感配置。</em>
          </article>
          <article className={styles.detailSummaryCard}>
            <span>售后</span>
            <strong>查阅 + 故障排查</strong>
            <em>在客服权限基础上增加故障历史、导出、现场排查辅助能力。</em>
          </article>
          <article className={styles.detailSummaryCard}>
            <span>只读 / 经销商</span>
            <strong>受限查看</strong>
            <em>仅允许访问指定环境或指定客户设备，不显示账号管理、导出和服务工具。</em>
          </article>
        </div>
      </section>
    </main>
  );
}
