"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import styles from "@/app/console.module.css";
import { buildQueryString, formatChartMetricValue } from "@/app/dashboard/helpers";
import { formatDateTime } from "@/lib/format";
import type { DashboardHistoryState, MetricHistoryPoint } from "@/lib/iot-platform";

type DeviceMetricHistoryModalProps = {
  environment: string;
  deviceId: string;
  metricIdentifier: string;
  metricLabel: string;
  initialMode: "chart" | "table";
  open: boolean;
  onClose: () => void;
};

type HistoryQuery = {
  metricId: string;
  hours: number;
  startAt: string;
  endAt: string;
};

const DEFAULT_HISTORY_HOURS = 24;

function findNearestPointIndex(points: MetricHistoryPoint[], targetTimestamp: number) {
  if (!points.length) {
    return null;
  }

  let left = 0;
  let right = points.length - 1;

  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (points[middle]!.timestamp < targetTimestamp) {
      left = middle + 1;
    } else {
      right = middle;
    }
  }

  const current = left;
  const previous = Math.max(0, current - 1);
  const currentDistance = Math.abs(points[current]!.timestamp - targetTimestamp);
  const previousDistance = Math.abs(points[previous]!.timestamp - targetTimestamp);

  return previousDistance <= currentDistance ? previous : current;
}

function buildChartCoordinates(points: MetricHistoryPoint[]) {
  const width = 920;
  const height = 280;
  const paddingX = 28;
  const paddingY = 24;

  if (!points.length) {
    return {
      width,
      height,
      coordinates: [] as Array<{ x: number; y: number; point: MetricHistoryPoint }>,
      polyline: "",
      minValue: null as number | null,
      maxValue: null as number | null,
      minTimestamp: null as number | null,
      maxTimestamp: null as number | null,
    };
  }

  const minValue = Math.min(...points.map((point) => point.value));
  const maxValue = Math.max(...points.map((point) => point.value));
  const minTimestamp = points[0]!.timestamp;
  const maxTimestamp = points[points.length - 1]!.timestamp;
  const timestampRange = maxTimestamp - minTimestamp || 1;
  const range = maxValue - minValue || 1;
  const coordinates = points.map((point) => {
    const x = paddingX + ((point.timestamp - minTimestamp) / timestampRange) * (width - paddingX * 2);
    const y = height - paddingY - ((point.value - minValue) / range) * (height - paddingY * 2);
    return { x, y, point };
  });

  return {
    width,
    height,
    coordinates,
    polyline: coordinates.map((coordinate) => `${coordinate.x},${coordinate.y}`).join(" "),
    minValue,
    maxValue,
    minTimestamp,
    maxTimestamp,
  };
}

export function DeviceMetricHistoryModal({
  environment,
  deviceId,
  metricIdentifier,
  metricLabel,
  initialMode,
  open,
  onClose,
}: DeviceMetricHistoryModalProps) {
  const [mode, setMode] = useState<"chart" | "table">(initialMode);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [query, setQuery] = useState<HistoryQuery>({
    metricId: metricIdentifier,
    hours: DEFAULT_HISTORY_HOURS,
    startAt: "",
    endAt: "",
  });
  const [historyState, setHistoryState] = useState<DashboardHistoryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isPending, startTransition] = useTransition();
  const cacheRef = useRef(new Map<string, DashboardHistoryState>());

  useEffect(() => {
    if (!open) {
      return;
    }

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    setQuery({
      metricId: metricIdentifier,
      hours: DEFAULT_HISTORY_HOURS,
      startAt: "",
      endAt: "",
    });
    setHistoryState(null);
    setError(null);
    setPage(1);
  }, [environment, deviceId, metricIdentifier]);

  useEffect(() => {
    setPage(1);
  }, [pageSize, historyState?.rawHistorySeries]);

  useEffect(() => {
    if (!open) {
      return;
    }

    applyQuery({
      metricId: metricIdentifier,
      hours: DEFAULT_HISTORY_HOURS,
      startAt: "",
      endAt: "",
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, metricIdentifier]);

  const chartPoints = historyState?.rawHistorySeries || historyState?.historySeries || [];
  const listPoints = historyState?.rawHistorySeries || [];
  const chart = useMemo(() => buildChartCoordinates(chartPoints), [chartPoints]);
  const totalPages = Math.max(1, Math.ceil(listPoints.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedPoints = listPoints.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const oldestPoint = listPoints[0];
  const latestPoint = listPoints[listPoints.length - 1];
  const hoveredCoordinate = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < chart.coordinates.length ? chart.coordinates[hoverIndex] : null;

  useEffect(() => {
    setHoverIndex(null);
  }, [chartPoints]);

  function applyQuery(nextQuery: HistoryQuery) {
    startTransition(() => {
      void (async () => {
        const queryString = buildQueryString({
          environment,
          deviceId,
          metricId: nextQuery.metricId,
          hours: nextQuery.hours,
          startAt: nextQuery.startAt,
          endAt: nextQuery.endAt,
        });

        const cached = cacheRef.current.get(queryString);
        if (cached) {
          setHistoryState(cached);
          setError(cached.notices[0] || null);
          setQuery(nextQuery);
          return;
        }

        const response = await fetch(`/api/dashboard/history?${queryString}`, {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          setError("加载属性历史数据失败。");
          return;
        }

        const payload = (await response.json()) as DashboardHistoryState;
        cacheRef.current.set(queryString, payload);
        setHistoryState(payload);
        setError(payload.notices[0] || null);
        setQuery(nextQuery);
      })();
    });
  }

  if (!open) {
    return null;
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.eyebrow}>Metric History</span>
            <h2 className={styles.sectionTitle}>{metricLabel}</h2>
            <p className={styles.sectionCopy}>{metricIdentifier} 的历史数据按需拉取，支持曲线图和列表查看。</p>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={styles.inlineActions}>
          <button type="button" className={mode === "chart" ? "button-primary" : "button-secondary"} onClick={() => setMode("chart")}>
            曲线图
          </button>
          <button type="button" className={mode === "table" ? "button-primary" : "button-secondary"} onClick={() => setMode("table")}>
            查看列表
          </button>
          {[
            { label: "24 小时", hours: 24 },
            { label: "3 天", hours: 72 },
            { label: "7 天", hours: 168 },
            { label: "全周期", hours: 0 },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={query.hours === preset.hours && !query.startAt && !query.endAt ? "button-primary" : "button-secondary"}
              onClick={() => {
                const nextQuery = {
                  metricId: metricIdentifier,
                  hours: preset.hours,
                  startAt: "",
                  endAt: "",
                };
                setQuery(nextQuery);
                applyQuery(nextQuery);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className={styles.filterRow}>
          <label className={styles.fieldLabel}>
            <span>开始时间</span>
            <input type="datetime-local" value={query.startAt} onChange={(event) => setQuery((current) => ({ ...current, startAt: event.target.value }))} className={styles.input} />
          </label>
          <label className={styles.fieldLabel}>
            <span>结束时间</span>
            <input type="datetime-local" value={query.endAt} onChange={(event) => setQuery((current) => ({ ...current, endAt: event.target.value }))} className={styles.input} />
          </label>
          <label className={styles.fieldLabel}>
            <span>操作</span>
            <button type="button" className="button-secondary" onClick={() => applyQuery(query)} disabled={isPending}>
              {isPending ? "加载中..." : "刷新历史数据"}
            </button>
          </label>
          {mode === "table" ? (
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
          ) : (
            <div className={styles.fieldLabel}>
              <span>数据区间</span>
              <div className={styles.chartPlaceholder}>
                {oldestPoint && latestPoint ? `${formatDateTime(oldestPoint.timestamp)} 至 ${formatDateTime(latestPoint.timestamp)}` : "当前区间暂无历史点"}
              </div>
            </div>
          )}
        </div>

        {error ? <div className={styles.notice}>{error}</div> : null}

        {mode === "chart" ? (
          chartPoints.length ? (
            <div className={styles.overviewShell}>
              <div className={styles.overviewHeader}>
                <span>原始点数 {listPoints.length}</span>
                <span>最新值 {formatChartMetricValue(metricIdentifier, latestPoint)}</span>
                <span>最小值 {chart.minValue === null ? "--" : formatChartMetricValue(metricIdentifier, { timestamp: 0, value: chart.minValue })}</span>
                <span>最大值 {chart.maxValue === null ? "--" : formatChartMetricValue(metricIdentifier, { timestamp: 0, value: chart.maxValue })}</span>
              </div>
              <div className={styles.historyChartShell}>
                <svg
                  viewBox={`0 0 ${chart.width} ${chart.height}`}
                  className={styles.overviewChart}
                  role="img"
                  aria-label={`${metricLabel} 历史曲线`}
                  onPointerMove={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    if (chart.minTimestamp === null || chart.maxTimestamp === null) {
                      setHoverIndex(null);
                      return;
                    }

                    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
                    const targetTimestamp = Math.round(chart.minTimestamp + ratio * (chart.maxTimestamp - chart.minTimestamp));
                    setHoverIndex(findNearestPointIndex(chartPoints, targetTimestamp));
                  }}
                  onPointerLeave={() => setHoverIndex(null)}
                >
                  <line x1="28" y1="24" x2="28" y2={chart.height - 24} stroke="rgba(108,129,156,0.28)" strokeWidth="1" />
                  <line x1="28" y1={chart.height - 24} x2={chart.width - 28} y2={chart.height - 24} stroke="rgba(108,129,156,0.28)" strokeWidth="1" />
                  <polyline points={chart.polyline} className={styles.overviewLine} />
                  {hoveredCoordinate ? (
                    <circle
                      cx={hoveredCoordinate.x}
                      cy={hoveredCoordinate.y}
                      r={5}
                      fill="white"
                      stroke="#2d5fff"
                      strokeWidth="2"
                    />
                  ) : null}
                  {hoveredCoordinate ? (
                    <line
                      x1={hoveredCoordinate.x}
                      y1="24"
                      x2={hoveredCoordinate.x}
                      y2={chart.height - 24}
                      className={styles.historyHoverLine}
                    />
                  ) : null}
                </svg>
                {hoveredCoordinate ? (
                  <div className={styles.historyChartTooltip} style={{ left: `${(hoveredCoordinate.x / chart.width) * 100}%`, top: `${(hoveredCoordinate.y / chart.height) * 100}%` }}>
                    <strong>{formatChartMetricValue(metricIdentifier, hoveredCoordinate.point)}</strong>
                    <span>{formatDateTime(hoveredCoordinate.point.timestamp)}</span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className={styles.emptyState}>当前时间范围内没有可绘制的历史点。</div>
          )
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>数值</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedPoints.map((point) => (
                    <tr key={`${point.timestamp}-${point.value}`}>
                      <td>{formatDateTime(point.timestamp)}</td>
                      <td>{formatChartMetricValue(metricIdentifier, point)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pagedPoints.length === 0 && !isPending ? <div className={styles.emptyState}>当前时间范围内没有可展示的历史数据。</div> : null}
            </div>

            <div className={styles.propertyToolbar}>
              <span className={styles.sectionKicker}>
                共 {listPoints.length} 条，当前第 {currentPage} / {totalPages} 页
              </span>
              <div className={styles.pagination}>
                <button type="button" className={styles.paginationButton} onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage <= 1}>
                  上一页
                </button>
                <button type="button" className={styles.paginationButton} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage >= totalPages}>
                  下一页
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
