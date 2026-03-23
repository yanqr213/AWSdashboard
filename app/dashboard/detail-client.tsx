"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import styles from "@/app/console.module.css";
import {
  buildDetailOverviewItems,
  buildKeyMetricCards,
  buildPropertyCategoryTabs,
  buildPropertyRows,
  buildQueryString,
  getFaultSeverityTone,
  getLatestMetricTimestamp,
  getMetricByIdentifiers,
} from "@/app/dashboard/helpers";
import { formatDateTime } from "@/lib/format";
import type { DashboardDetailState } from "@/lib/iot-platform";

const DeviceFaultHistoryModal = dynamic(
  () => import("@/app/dashboard/device-fault-history-modal").then((module) => module.DeviceFaultHistoryModal),
  {
    ssr: false,
  },
);

const DeviceMetricHistoryModal = dynamic(
  () => import("@/app/dashboard/device-metric-history-modal").then((module) => module.DeviceMetricHistoryModal),
  {
    ssr: false,
  },
);

const DeviceMetricComparisonPanel = dynamic(
  () => import("@/app/dashboard/device-metric-comparison-panel").then((module) => module.DeviceMetricComparisonPanel),
  {
    ssr: false,
  },
);

type DashboardDetailClientProps = {
  initialState: DashboardDetailState;
  deviceId: string;
};

function getToneClassName(severity: string) {
  const tone = getFaultSeverityTone(severity);
  if (tone === "critical") {
    return styles.faultCritical;
  }

  if (tone === "warning") {
    return styles.faultWarning;
  }

  if (tone === "notice") {
    return styles.faultNotice;
  }

  return styles.faultDefault;
}

export function DashboardDetailClient({ initialState, deviceId }: DashboardDetailClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState(initialState);
  const [environment, setEnvironment] = useState<string>(initialState.selectedEnvironment.key);
  const [fieldSearch, setFieldSearch] = useState("");
  const [propertyScope, setPropertyScope] = useState<"reported" | "catalog">("reported");
  const [propertyCategory, setPropertyCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [faultModalOpen, setFaultModalOpen] = useState(false);
  const [comparisonPanelOpen, setComparisonPanelOpen] = useState(false);
  const [historyMetric, setHistoryMetric] = useState<{ identifier: string; label: string } | null>(null);
  const [historyModalMode, setHistoryModalMode] = useState<"chart" | "table">("chart");
  const [isPending, startTransition] = useTransition();
  const detailCacheRef = useRef(new Map<string, DashboardDetailState>([[`${initialState.selectedEnvironment.key}:${deviceId}`, initialState]]));
  const deferredFieldSearch = useDeferredValue(fieldSearch.trim().toLowerCase());

  useEffect(() => {
    setPage(1);
  }, [deferredFieldSearch, pageSize, propertyCategory, propertyScope, state.currentValues]);

  const overviewItems = useMemo(
    () => buildDetailOverviewItems(state.currentValues, state.recentDailySummaries, state.decodedFaults),
    [state.currentValues, state.decodedFaults, state.recentDailySummaries],
  );
  const keyMetricCards = useMemo(() => buildKeyMetricCards(state.currentValues), [state.currentValues]);
  const reportedPropertyRows = useMemo(() => buildPropertyRows(state.currentValues), [state.currentValues]);
  const catalogPropertyRows = useMemo(() => buildPropertyRows(state.currentValues, true), [state.currentValues]);
  const allPropertyRows = propertyScope === "catalog" ? catalogPropertyRows : reportedPropertyRows;
  const propertyCategoryTabs = useMemo(() => buildPropertyCategoryTabs(allPropertyRows), [allPropertyRows]);

  useEffect(() => {
    if (propertyCategory === "all") {
      return;
    }

    if (!propertyCategoryTabs.some((tab) => tab.key === propertyCategory)) {
      setPropertyCategory("all");
    }
  }, [propertyCategory, propertyCategoryTabs]);

  const propertyRows = useMemo(() => {
    const scopedRows =
      propertyCategory === "all" ? allPropertyRows : allPropertyRows.filter((row) => row.module === propertyCategory);
    if (!deferredFieldSearch) {
      return scopedRows;
    }

    return scopedRows.filter((row) => {
      return (
        row.identifier.toLowerCase().includes(deferredFieldSearch) ||
        row.shortCode.toLowerCase().includes(deferredFieldSearch) ||
        row.name.toLowerCase().includes(deferredFieldSearch) ||
        row.module.toLowerCase().includes(deferredFieldSearch)
      );
    });
  }, [allPropertyRows, deferredFieldSearch, propertyCategory]);

  const totalPages = Math.max(1, Math.ceil(propertyRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = propertyRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const latestReportedAt = useMemo(
    () => getLatestMetricTimestamp(state.currentValues, state.selectedDevice?.lastSeen || null),
    [state.currentValues, state.selectedDevice?.lastSeen],
  );
  const serialNumber = getMetricByIdentifiers(state.currentValues, ["SN", "BMSSN"])?.value || "--";

  function loadDetail(nextEnvironment: string, force = false) {
    startTransition(() => {
      void (async () => {
        const cacheKey = `${nextEnvironment}:${deviceId}`;
        if (!force) {
          const cached = detailCacheRef.current.get(cacheKey);
          if (cached) {
            setState(cached);
            setEnvironment(nextEnvironment);
            router.replace(`${pathname}?${buildQueryString({ environment: nextEnvironment })}`, { scroll: false });
            return;
          }
        }

        const queryString = buildQueryString({
          environment: nextEnvironment,
          deviceId,
        });
        const response = await fetch(`/api/dashboard/detail?${queryString}`, {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          return;
        }

        const nextState = (await response.json()) as DashboardDetailState;
        detailCacheRef.current.set(cacheKey, nextState);
        setState(nextState);
        setEnvironment(nextEnvironment);
        router.replace(`${pathname}?${buildQueryString({ environment: nextEnvironment })}`, { scroll: false });
      })();
    });
  }

  function openMetricHistory(identifier: string, label: string, mode: "chart" | "table") {
    setHistoryMetric({ identifier, label });
    setHistoryModalMode(mode);
  }

  return (
    <main className={`${styles.page} ${styles.pageWide}`}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <div className={styles.heroMain}>
            <span className={styles.eyebrow}>Device Detail</span>
            <h1 className={styles.heroTitle}>{state.selectedDevice?.id || deviceId}</h1>
            <p className={styles.heroCopy}>详情页改成独立加载。当前只展示高频信息、属性明细和故障信息。</p>
          </div>
          <div className={styles.heroActions}>
            <Link href={`/?${buildQueryString({ environment })}`} className="button-secondary button-link">
              返回设备列表
            </Link>
            <button type="button" className="button-secondary" onClick={() => loadDetail(environment, true)} disabled={isPending}>
              {isPending ? "刷新中..." : "刷新详情"}
            </button>
          </div>
        </div>

        <div className={styles.chipGrid}>
          <article className={styles.chipCard}>
            <span className={styles.chipLabel}>设备型号</span>
            <strong className={styles.chipValue}>{state.selectedDevice?.modelLabel || "--"}</strong>
            <span className={styles.chipHint}>按 PK 自动识别</span>
          </article>
          <article className={styles.chipCard}>
            <span className={styles.chipLabel}>最后上报</span>
            <strong className={styles.chipValue}>{formatDateTime(latestReportedAt)}</strong>
            <span className={styles.chipHint}>最新属性时间</span>
          </article>
          <article className={styles.chipCard}>
            <span className={styles.chipLabel}>序列号</span>
            <strong className={styles.chipValue}>{serialNumber}</strong>
            <span className={styles.chipHint}>SN / BMSSN</span>
          </article>
          <article className={styles.chipCard}>
            <span className={styles.chipLabel}>字段数</span>
            <strong className={styles.chipValue}>{state.currentValues.length}</strong>
            <span className={styles.chipHint}>当前解析属性</span>
          </article>
        </div>
      </section>

      {state.notices.length ? (
        <section className={styles.noticeStack}>
          {state.notices.map((notice) => (
            <div key={notice} className={styles.notice}>
              {notice}
            </div>
          ))}
        </section>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>详情设置</h2>
            <p className={styles.sectionCopy}>环境切换只刷新当前设备，不再重拉整页列表。</p>
          </div>
          <span className={styles.sectionKicker}>{state.selectedEnvironment.label}</span>
        </div>

        <div className={styles.filterRow}>
          <label className={styles.fieldLabel}>
            <span>环境</span>
            <select
              value={environment}
              onChange={(event) => {
                const nextEnvironment = event.target.value;
                setEnvironment(nextEnvironment);
                loadDetail(nextEnvironment);
              }}
              className={styles.select}
            >
              {state.environments.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.fieldLabel}>
            <span>字段检索</span>
            <input value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} className={styles.input} placeholder="按字段名、标识符或短码筛选" />
          </label>
          <label className={styles.fieldLabel}>
            <span>每页行数</span>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className={styles.select}>
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} 行
                </option>
              ))}
            </select>
          </label>
          <label className={styles.fieldLabel}>
            <span>故障操作</span>
            <button type="button" className="button-secondary" onClick={() => setFaultModalOpen(true)}>
              查看历史故障
            </button>
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>关键指标</h2>
            <p className={styles.sectionCopy}>高频指标改成可点击卡片，直接查看该指标曲线图。</p>
          </div>
        </div>

        <div className={styles.metricCardGrid}>
          {keyMetricCards.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`${styles.metricCardButton} ${!item.isAvailable ? styles.metricCardDisabled : ""}`}
              onClick={() => {
                if (item.identifier) {
                  openMetricHistory(item.identifier, item.metricLabel, "chart");
                }
              }}
              disabled={!item.isAvailable}
            >
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <em>{item.hint}</em>
            </button>
          ))}
        </div>

        <div className={styles.detailSummaryGrid}>
          {overviewItems.map((item) => (
            <article key={`${item.label}-${item.value}`} className={styles.detailSummaryCard}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              {item.hint ? <em>{item.hint}</em> : null}
            </article>
          ))}
        </div>
      </section>

      <section className={styles.contentGrid}>
        <div className={styles.stack}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>属性列表</h2>
                <p className={styles.sectionCopy}>可切换已上报字段和完整物模型目录，再按模块分组、搜索和分页定位问题字段。</p>
              </div>
              <span className={styles.sectionKicker}>
                已上报 {reportedPropertyRows.length} / 物模型 {catalogPropertyRows.length} 条
              </span>
            </div>

            <div className={styles.tabRow}>
              <button
                type="button"
                className={`${styles.tabButton} ${propertyScope === "reported" ? styles.tabButtonActive : ""}`}
                onClick={() => setPropertyScope("reported")}
              >
                <span>仅看已上报</span>
                <strong>{reportedPropertyRows.length}</strong>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${propertyScope === "catalog" ? styles.tabButtonActive : ""}`}
                onClick={() => setPropertyScope("catalog")}
              >
                <span>全部物模型</span>
                <strong>{catalogPropertyRows.length}</strong>
              </button>
            </div>

            <div className={styles.tabRow}>
              {propertyCategoryTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`${styles.tabButton} ${propertyCategory === tab.key ? styles.tabButtonActive : ""}`}
                  onClick={() => setPropertyCategory(tab.key)}
                >
                  <span>{tab.label}</span>
                  <strong>{tab.count}</strong>
                </button>
              ))}
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>标识符</th>
                    <th>值</th>
                    <th>更新时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => (
                    <tr key={row.identifier}>
                      <td>
                        <span className={styles.tableStrong}>{row.name}</span>
                        <span className={styles.tableSubtle}>
                          {row.shortCode} · {row.module}
                        </span>
                      </td>
                      <td>{row.identifier}</td>
                      <td>{row.value}</td>
                      <td>{formatDateTime(row.timestamp)}</td>
                      <td>
                        {row.isReported ? (
                          <div className={styles.tableActions}>
                            <button type="button" className={styles.tableAction} onClick={() => openMetricHistory(row.identifier, row.name, "chart")}>
                              曲线图
                            </button>
                            <button type="button" className={styles.tableAction} onClick={() => openMetricHistory(row.identifier, row.name, "table")}>
                              查看列表
                            </button>
                          </div>
                        ) : (
                          <span className={styles.tableSubtle}>当前未上报</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pagedRows.length === 0 ? <div className={styles.emptyState}>当前筛选条件下没有匹配到属性字段。</div> : null}
            </div>

            <div className={styles.pagination}>
              <button type="button" className={styles.paginationButton} onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage <= 1}>
                上一页
              </button>
              <span>
                第 {currentPage} / {totalPages} 页
              </span>
              <button type="button" className={styles.paginationButton} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage >= totalPages}>
                下一页
              </button>
            </div>
          </section>
        </div>

        <div className={styles.stack}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>当前故障</h2>
                <p className={styles.sectionCopy}>当前状态和历史故障拆开显示，首屏只放当前激活项。</p>
              </div>
              <span className={styles.sectionKicker}>{state.decodedFaults.length} 条激活故障</span>
            </div>

            <div className={styles.faultList}>
              {state.decodedFaults.map((fault) => (
                <article key={`${fault.code}-${fault.identifier}`} className={styles.faultItem}>
                  <div className={styles.faultRow}>
                    <span className={`${styles.faultBadge} ${getToneClassName(fault.severity)}`}>{fault.severity}</span>
                    <strong>{fault.code}</strong>
                  </div>
                  <strong>{fault.name || fault.meaning}</strong>
                  <span>{fault.description || fault.display}</span>
                  <span className={styles.tableSubtle}>
                    {fault.sourceLabel} · {fault.rawHex}
                  </span>
                </article>
              ))}
              {state.decodedFaults.length === 0 ? <div className={styles.emptyState}>当前设备没有激活中的故障位。</div> : null}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>近 3 天摘要</h2>
                <p className={styles.sectionCopy}>按天聚合保留高频结果，减少首屏原始对象展示。</p>
              </div>
            </div>

            <div className={styles.miniGrid}>
              {state.recentDailySummaries.map((summary) => (
                <article key={summary.day} className={styles.miniCard}>
                  <strong>{summary.day}</strong>
                  <span>样本数 {summary.sampleCount}</span>
                  <span>发电量 {summary.generation}</span>
                  <span>峰值功率 {summary.peakOutputPower}</span>
                </article>
              ))}
            </div>
            {state.recentDailySummaries.length === 0 ? <div className={styles.emptyState}>当前还没有可展示的近 3 天运行记录。</div> : null}
          </section>

          <details className={styles.details}>
            <summary>调试信息</summary>
            <div className={styles.detailsBody}>
              <div className={styles.debugGrid}>
                <article className={styles.debugCard}>
                  <span>数据源</span>
                  <strong>{state.dataSourceMode}</strong>
                </article>
                <article className={styles.debugCard}>
                  <span>对象发现</span>
                  <strong>{state.queryStats.objectsDiscovered}</strong>
                </article>
                <article className={styles.debugCard}>
                  <span>对象解析</span>
                  <strong>{state.queryStats.objectsParsed}</strong>
                </article>
                <article className={styles.debugCard}>
                  <span>缓存命中</span>
                  <strong>{state.queryStats.cacheHits}</strong>
                </article>
              </div>
            </div>
          </details>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>指标叠加分析</h2>
            <p className={styles.sectionCopy}>默认不自动加载历史曲线。点开后再按需取数，更适合完整数据量下的问题定位。</p>
          </div>
          <span className={styles.sectionKicker}>按需加载</span>
        </div>

        <div className={styles.toggleRow}>
          <span>推荐先叠加 `SOC + 电池最低温度 + 市电口功率`，快速判断温度、充放电和控制策略之间的关联。</span>
          <button type="button" className="button-secondary" onClick={() => setComparisonPanelOpen((current) => !current)}>
            {comparisonPanelOpen ? "收起分析面板" : "展开分析面板"}
          </button>
        </div>

        {comparisonPanelOpen && state.selectedDeviceId ? (
          <DeviceMetricComparisonPanel
            environment={environment}
            deviceId={state.selectedDeviceId}
            currentValues={state.currentValues}
          />
        ) : null}
      </section>

      {state.selectedDeviceId ? (
        <DeviceFaultHistoryModal
          environment={environment}
          deviceId={state.selectedDeviceId}
          open={faultModalOpen}
          onClose={() => setFaultModalOpen(false)}
        />
      ) : null}
      {state.selectedDeviceId && historyMetric ? (
        <DeviceMetricHistoryModal
          environment={environment}
          deviceId={state.selectedDeviceId}
          metricIdentifier={historyMetric.identifier}
          metricLabel={historyMetric.label}
          initialMode={historyModalMode}
          open={historyMetric !== null}
          onClose={() => setHistoryMetric(null)}
        />
      ) : null}
    </main>
  );
}
