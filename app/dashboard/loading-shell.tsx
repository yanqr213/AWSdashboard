import styles from "@/app/console.module.css";

export function DashboardListSkeleton() {
  return (
    <main className={`${styles.page} ${styles.pageWide}`}>
      <section className={styles.skeletonHero} />
      <section className={styles.chipGrid}>
        {Array.from({ length: 4 }).map((_, index) => (
          <article key={index} className={styles.skeletonCard} />
        ))}
      </section>
      <section className={styles.section}>
        <div className={styles.skeletonTable}>
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonLine} />
        </div>
      </section>
    </main>
  );
}

export function DashboardDetailSkeleton() {
  return (
    <main className={`${styles.page} ${styles.pageWide}`}>
      <section className={styles.skeletonHero} />
      <section className={styles.chipGrid}>
        {Array.from({ length: 4 }).map((_, index) => (
          <article key={index} className={styles.skeletonCard} />
        ))}
      </section>
      <section className={styles.contentGrid}>
        <div className={styles.stack}>
          <section className={styles.skeletonCard} style={{ minHeight: 420 }} />
          <section className={styles.skeletonCard} style={{ minHeight: 360 }} />
        </div>
        <div className={styles.stack}>
          <section className={styles.skeletonCard} style={{ minHeight: 280 }} />
          <section className={styles.skeletonCard} style={{ minHeight: 220 }} />
        </div>
      </section>
    </main>
  );
}
