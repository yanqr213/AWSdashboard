"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import styles from "@/app/console.module.css";
import { buildQueryString } from "@/app/dashboard/helpers";
import { formatDateTime } from "@/lib/format";
import type { DashboardListState } from "@/lib/iot-platform";

type DashboardListClientProps = {
  initialState: DashboardListState;
};

export function DashboardListClient({ initialState }: DashboardListClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState(initialState);
  const [environment, setEnvironment] = useState<string>(initialState.selectedEnvironment.key);
  const [deviceSearch, setDeviceSearch] = useState(initialState.deviceSearch);
  const [deviceType, setDeviceType] = useState<"all" | "500" | "500PRO">(initialState.deviceType);
  const [page, setPage] = useState(initialState.page);
  const [isPending, startTransition] = useTransition();
  const initialQueryKey = buildQueryString({
    environment: initialState.selectedEnvironment.key,
    deviceSearch: initialState.deviceSearch || undefined,
    deviceType: initialState.deviceType === "all" ? undefined : initialState.deviceType,
    page: initialState.page,
    pageSize: initialState.pageSize,
  });
  const listCacheRef = useRef(new Map<string, DashboardListState>([[initialQueryKey, initialState]]));
  const lastLoadedKeyRef = useRef(initialQueryKey);
  const deferredSearch = useDeferredValue(deviceSearch.trim());
  const queryKey = buildQueryString({
    environment,
    deviceSearch: deferredSearch || undefined,
    deviceType: deviceType === "all" ? undefined : deviceType,
    page,
    pageSize: state.pageSize,
  });

  function syncUrl(nextKey: string) {
    router.replace(nextKey ? `${pathname}?${nextKey}` : pathname, { scroll: false });
  }

  function loadList(nextKey: string, force = false) {
    startTransition(() => {
      void (async () => {
        if (!force) {
          const cached = listCacheRef.current.get(nextKey);
          if (cached) {
            setState(cached);
            setEnvironment(cached.selectedEnvironment.key);
            setDeviceSearch(cached.deviceSearch);
            setDeviceType(cached.deviceType);
            setPage(cached.page);
            lastLoadedKeyRef.current = nextKey;
            syncUrl(nextKey);
            return;
          }
        }

        const response = await fetch(`/api/dashboard/list?${nextKey}`, {
          method: "GET",
          credentials: "same-origin",
        });

        if (!response.ok) {
          return;
        }

        const nextState = (await response.json()) as DashboardListState;
        listCacheRef.current.set(nextKey, nextState);
        setState(nextState);
        setEnvironment(nextState.selectedEnvironment.key);
        setDeviceSearch(nextState.deviceSearch);
        setDeviceType(nextState.deviceType);
        setPage(nextState.page);
        lastLoadedKeyRef.current = nextKey;
        syncUrl(nextKey);
      })();
    });
  }

  useEffect(() => {
    if (queryKey === lastLoadedKeyRef.current) {
      return;
    }

    loadList(queryKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  return (
    <main className={`${styles.page} ${styles.pageWide}`}>
      <section className={`${styles.hero}`}>
        <div className={styles.heroTop}>
          <div className={styles.heroMain}>
            <span className={styles.eyebrow}>Device Monitor</span>
            <h1 className={styles.heroTitle}>设备列表</h1>
            <p className={styles.heroCopy}>首页只保留设备清单和轻量状态。设备列表改成每页 10 台，详情、图表、故障历史继续按需加载。</p>
          </div>
          <div className={styles.heroActions}>
            <span className={`${styles.modeChip} ${styles.modeChipLive}`}>{state.selectedEnvironment.label}</span>
            <button type="button" className="button-secondary" onClick={() => loadList(queryKey, true)} disabled={isPending}>
              {isPending ? "刷新中..." : "刷新列表"}
            </button>
          </div>
        </div>

        <div className={styles.chipGrid}>
          <article className={styles.chipCard}>
            <span className={styles.chipLabel}>设备总数</span>
            <strong className={styles.chipValue}>{state.fleetSummary.totalDevices}</strong>
            <span className={styles.chipHint}>当前环境已识别设备</span>
          </article>
          <article className={styles.chipCard}>
            <span className={styles.chipLabel}>500</span>
            <strong className={styles.chipValue}>{state.fleetSummary.model500Count}</strong>
            <span className={styles.chipHint}>PK = 1</span>
          </article>
          <article className={styles.chipCard}>
            <span className={styles.chipLabel}>500PRO</span>
            <strong className={styles.chipValue}>{state.fleetSummary.model500ProCount}</strong>
            <span className={styles.chipHint}>PK = 2</span>
          </article>
          <article className={styles.chipCard}>
            <span className={styles.chipLabel}>最新上报</span>
            <strong className={styles.chipValue}>{formatDateTime(state.fleetSummary.latestReportedAt)}</strong>
            <span className={styles.chipHint}>来自当前列表最新设备</span>
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
            <h2 className={styles.sectionTitle}>设备监控</h2>
            <p className={styles.sectionCopy}>桌面后台优先，列表改成服务端分页和筛选，详情通过独立页面加载。</p>
          </div>
          <span className={styles.sectionKicker}>
            {state.totalItems} 台匹配设备 · 第 {state.page} / {state.totalPages} 页
          </span>
        </div>

        <div className={styles.filterRow}>
          <label className={styles.fieldLabel}>
            <span>环境</span>
            <select
              value={environment}
              onChange={(event) => {
                const nextEnvironment = event.target.value;
                setEnvironment(nextEnvironment);
                setPage(1);
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
            <span>设备检索</span>
            <input
              value={deviceSearch}
              onChange={(event) => {
                setDeviceSearch(event.target.value);
                setPage(1);
              }}
              className={styles.input}
              placeholder="按 DeviceKey 或设备名称搜索"
            />
          </label>

          <label className={styles.fieldLabel}>
            <span>设备型号</span>
            <select
              value={deviceType}
              onChange={(event) => {
                setDeviceType(event.target.value as "all" | "500" | "500PRO");
                setPage(1);
              }}
              className={styles.select}
            >
              <option value="all">全部型号</option>
              <option value="500">500</option>
              <option value="500PRO">500PRO</option>
            </select>
          </label>

          <label className={styles.fieldLabel}>
            <span>快速操作</span>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setDeviceSearch("");
                setDeviceType("all");
                setPage(1);
              }}
            >
              清空筛选
            </button>
          </label>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>设备名称</th>
                <th>设备型号</th>
                <th>物模型字段</th>
                <th>最后上报时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {state.deviceOptions.map((device) => (
                <tr key={device.id}>
                  <td>
                    <span className={styles.tableStrong}>{device.label}</span>
                    <span className={styles.tableSubtle}>{device.id}</span>
                  </td>
                  <td>{device.modelLabel}</td>
                  <td>{device.metricCount}</td>
                  <td>{formatDateTime(device.lastSeen)}</td>
                  <td>
                    <div className={styles.tableActions}>
                      <Link href={`/devices/${device.id}?${buildQueryString({ environment: state.selectedEnvironment.key })}`} className={styles.tableAction}>
                        查看
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.deviceOptions.length === 0 ? <div className={styles.emptyState}>当前筛选条件下没有匹配到设备。</div> : null}
        </div>

        <div className={styles.pagination}>
          <button type="button" className={styles.paginationButton} onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={state.page <= 1 || isPending}>
            上一页
          </button>
          <span>
            第 {state.page} / {state.totalPages} 页 · 每页 {state.pageSize} 台
          </span>
          <button
            type="button"
            className={styles.paginationButton}
            onClick={() => setPage((current) => Math.min(state.totalPages, current + 1))}
            disabled={state.page >= state.totalPages || isPending}
          >
            下一页
          </button>
        </div>
      </section>
    </main>
  );
}
