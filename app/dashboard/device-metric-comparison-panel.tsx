"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import styles from "@/app/console.module.css";
import { buildQueryString, formatChartMetricValue } from "@/app/dashboard/helpers";
import { formatDateTime } from "@/lib/format";
import type { CurrentMetricValue, DashboardHistoryState, MetricHistoryPoint } from "@/lib/iot-platform";

type DeviceMetricComparisonPanelProps = {
  environment: string;
  deviceId: string;
  currentValues: CurrentMetricValue[];
};

type ComparisonQuery = {
  hours: number;
  startAt: string;
  endAt: string;
};

const DEFAULT_COMPARISON_HOURS = 24;

type MetricCandidate = {
  identifier: string;
  label: string;
};

type PreparedSeries = {
  identifier: string;
  label: string;
  color: string;
  points: MetricHistoryPoint[];
  polyline: string;
  latestPoint: MetricHistoryPoint | null;
  minValue: number | null;
  maxValue: number | null;
};

const CHART_WIDTH = 1100;
const CHART_HEIGHT = 320;
const CHART_PADDING_X = 32;
const CHART_PADDING_Y = 28;
const SERIES_COLORS = ["#2d5fff", "#0f9d8f", "#ff7d45", "#bb57ff", "#e0a11a", "#dc4c5b"];
const DEFAULT_METRIC_GROUPS = [
  ["SOC", "SC0", "SOCi"],
  ["TI0", "MinTi", "TA0", "MaxTi", "ShellT", "EnvT"],
  ["GridP", "GP", "GridPSet", "GS"],
] as const;

function resolveDefaultMetricIds(metricCandidates: MetricCandidate[]) {
  const availableIds = new Set(metricCandidates.map((item) => item.identifier));
  const defaults: string[] = [];

  for (const group of DEFAULT_METRIC_GROUPS) {
    const match = group.find((identifier) => availableIds.has(identifier));
    if (match) {
      defaults.push(match);
    }
  }

  return defaults;
}

function getMetricPriority(identifier: string) {
  const orderedIdentifiers = DEFAULT_METRIC_GROUPS.flat() as string[];
  const index = orderedIdentifiers.indexOf(identifier);
  return index === -1 ? orderedIdentifiers.length : index;
}

function buildMetricCandidates(currentValues: CurrentMetricValue[]) {
  const seen = new Map<string, MetricCandidate>();

  for (const item of currentValues) {
    if (typeof item.rawValue !== "number") {
      continue;
    }

    if (!seen.has(item.identifier)) {
      seen.set(item.identifier, {
        identifier: item.identifier,
        label: item.label,
      });
    }
  }

  return [...seen.values()].sort((left, right) => {
    return (
      getMetricPriority(left.identifier) - getMetricPriority(right.identifier) ||
      left.label.localeCompare(right.label) ||
      left.identifier.localeCompare(right.identifier)
    );
  });
}

function buildSeriesPolyline(points: MetricHistoryPoint[], minTimestamp: number, maxTimestamp: number) {
  if (!points.length) {
    return {
      polyline: "",
      minValue: null as number | null,
      maxValue: null as number | null,
      latestPoint: null as MetricHistoryPoint | null,
    };
  }

  const minValue = Math.min(...points.map((point) => point.value));
  const maxValue = Math.max(...points.map((point) => point.value));
  const valueRange = maxValue - minValue || 1;
  const timeRange = maxTimestamp - minTimestamp || 1;

  const polyline = points
    .map((point) => {
      const x = CHART_PADDING_X + ((point.timestamp - minTimestamp) / timeRange) * (CHART_WIDTH - CHART_PADDING_X * 2);
      const normalizedValue = (point.value - minValue) / valueRange;
      const y = CHART_HEIGHT - CHART_PADDING_Y - normalizedValue * (CHART_HEIGHT - CHART_PADDING_Y * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return {
    polyline,
    minValue,
    maxValue,
    latestPoint: points[points.length - 1] || null,
  };
}

function findNearestPoint(points: MetricHistoryPoint[], targetTimestamp: number) {
  if (!points.length) {
    return null;
  }

  let nearest = points[0];
  let nearestDistance = Math.abs(points[0].timestamp - targetTimestamp);

  for (const point of points) {
    const distance = Math.abs(point.timestamp - targetTimestamp);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }

  return nearest;
}

export function DeviceMetricComparisonPanel({
  environment,
  deviceId,
  currentValues,
}: DeviceMetricComparisonPanelProps) {
  const metricCandidates = useMemo(() => buildMetricCandidates(currentValues), [currentValues]);
  const defaultMetricIds = useMemo(() => resolveDefaultMetricIds(metricCandidates).slice(0, 3), [metricCandidates]);
  const [query, setQuery] = useState<ComparisonQuery>({
    hours: DEFAULT_COMPARISON_HOURS,
    startAt: "",
    endAt: "",
  });
  const [selectedMetricIds, setSelectedMetricIds] = useState<string[]>(defaultMetricIds);
  const [candidateMetricId, setCandidateMetricId] = useState("");
  const [historyMap, setHistoryMap] = useState<Record<string, DashboardHistoryState>>({});
  const [error, setError] = useState<string | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const cacheRef = useRef(new Map<string, DashboardHistoryState>());

  useEffect(() => {
    const availableIds = new Set(metricCandidates.map((item) => item.identifier));
    const nextSelected = selectedMetricIds.filter((identifier) => availableIds.has(identifier));

    if (!nextSelected.length) {
      setSelectedMetricIds(defaultMetricIds);
      return;
    }

    if (nextSelected.length !== selectedMetricIds.length) {
      setSelectedMetricIds(nextSelected);
    }
  }, [defaultMetricIds, metricCandidates, selectedMetricIds]);

  useEffect(() => {
    const nextCandidate = metricCandidates.find((item) => !selectedMetricIds.includes(item.identifier))?.identifier || "";
    setCandidateMetricId(nextCandidate);
  }, [metricCandidates, selectedMetricIds]);

  function loadSeries(nextQuery: ComparisonQuery, force = false) {
    if (!selectedMetricIds.length) {
      setHistoryMap({});
      setError("请至少选择一个指标。");
      return;
    }

    startTransition(() => {
      (async () => {
        const entries = await Promise.all(
          selectedMetricIds.map(async (identifier) => {
            const queryString = buildQueryString({
              environment,
              deviceId,
              metricId: identifier,
              hours: nextQuery.hours,
              startAt: nextQuery.startAt,
              endAt: nextQuery.endAt,
            });

            const cached = !force ? cacheRef.current.get(queryString) : null;
            if (cached) {
              return [identifier, cached] as const;
            }

            const response = await fetch(`/api/dashboard/history?${queryString}`, {
              method: "GET",
              credentials: "same-origin",
            });

            if (!response.ok) {
              throw new Error("加载叠加图历史数据失败。");
            }

            const payload = (await response.json()) as DashboardHistoryState;
            cacheRef.current.set(queryString, payload);
            return [identifier, payload] as const;
          }),
        );

        const nextHistoryMap = Object.fromEntries(entries) as Record<string, DashboardHistoryState>;

        setHistoryMap(nextHistoryMap);
        setQuery(nextQuery);

        const firstNotice = Object.values(nextHistoryMap)
          .flatMap((item) => item.notices)
          .find((notice) => Boolean(notice));
        setError(firstNotice || null);
      })().catch(() => {
        setError("加载叠加图历史数据失败。");
      });
    });
  }

  useEffect(() => {
    loadSeries(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment, deviceId, selectedMetricIds.join("|")]);

  useEffect(() => {
    setHoverRatio(null);
  }, [historyMap, query]);

  const selectedMetrics = useMemo(() => {
    return selectedMetricIds.map((identifier, index) => {
      const candidate = metricCandidates.find((item) => item.identifier === identifier);
      return {
        identifier,
        label: candidate?.label || identifier,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        historyState: historyMap[identifier] || null,
      };
    });
  }, [historyMap, metricCandidates, selectedMetricIds]);

  const chartDomain = useMemo(() => {
    const allPoints = selectedMetrics.flatMap((item) => item.historyState?.rawHistorySeries || item.historyState?.historySeries || []);
    if (!allPoints.length) {
      return null;
    }

    const minTimestamp = Math.min(...allPoints.map((point) => point.timestamp));
    const maxTimestamp = Math.max(...allPoints.map((point) => point.timestamp));
    return { minTimestamp, maxTimestamp };
  }, [selectedMetrics]);

  const preparedSeries = useMemo(() => {
    if (!chartDomain) {
      return [] as PreparedSeries[];
    }

    return selectedMetrics.map((item) => {
      const points = item.historyState?.rawHistorySeries || item.historyState?.historySeries || [];
      const polyline = buildSeriesPolyline(points, chartDomain.minTimestamp, chartDomain.maxTimestamp);

      return {
        identifier: item.identifier,
        label: item.label,
        color: item.color,
        points,
        polyline: polyline.polyline,
        latestPoint: polyline.latestPoint,
        minValue: polyline.minValue,
        maxValue: polyline.maxValue,
      } satisfies PreparedSeries;
    });
  }, [chartDomain, selectedMetrics]);

  const hoverTimestamp = useMemo(() => {
    if (hoverRatio === null || !chartDomain) {
      return null;
    }

    return Math.round(chartDomain.minTimestamp + hoverRatio * (chartDomain.maxTimestamp - chartDomain.minTimestamp));
  }, [chartDomain, hoverRatio]);

  const tooltipEntries = useMemo(() => {
    if (hoverTimestamp === null) {
      return [];
    }

    return preparedSeries
      .map((series) => ({
        ...series,
        point: findNearestPoint(series.points, hoverTimestamp),
      }))
      .filter((item): item is PreparedSeries & { point: MetricHistoryPoint } => item.point !== null);
  }, [hoverTimestamp, preparedSeries]);

  const tooltipTimestamp = tooltipEntries[0]?.point.timestamp || hoverTimestamp;
  const tooltipLeft = CHART_PADDING_X + (hoverRatio || 0) * (CHART_WIDTH - CHART_PADDING_X * 2);
  const availableCandidateMetrics = metricCandidates.filter((item) => !selectedMetricIds.includes(item.identifier));

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>指标叠加分析</h2>
          <p className={styles.sectionCopy}>先选指标，再选时间范围。图中按各指标自身量程归一化，适合看联动趋势；精确值以悬浮提示为准。</p>
        </div>
        <span className={styles.sectionKicker}>{selectedMetricIds.length} 个指标</span>
      </div>

      <div className={styles.toggleRow}>
        <span>建议把问题指标分成 2 到 4 条叠加，不要一次放太多线。默认推荐 `SOC + 电池最低温度 + 市电口功率`。</span>
      </div>

      <div className={styles.filterRow}>
        <label className={styles.fieldLabel}>
          <span>添加指标</span>
          <div className={styles.inlineActions}>
            <select value={candidateMetricId} onChange={(event) => setCandidateMetricId(event.target.value)} className={styles.select}>
              <option value="">请选择指标</option>
              {availableCandidateMetrics.map((item) => (
                <option key={item.identifier} value={item.identifier}>
                  {item.label} ({item.identifier})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                if (!candidateMetricId) {
                  return;
                }

                setSelectedMetricIds((current) => {
                  if (current.includes(candidateMetricId)) {
                    return current;
                  }

                  return [...current, candidateMetricId].slice(0, 6);
                });
              }}
              disabled={!candidateMetricId}
            >
              添加
            </button>
          </div>
        </label>
        <label className={styles.fieldLabel}>
          <span>开始时间</span>
          <input
            type="datetime-local"
            value={query.startAt}
            onChange={(event) => setQuery((current) => ({ ...current, startAt: event.target.value }))}
            className={styles.input}
          />
        </label>
        <label className={styles.fieldLabel}>
          <span>结束时间</span>
          <input
            type="datetime-local"
            value={query.endAt}
            onChange={(event) => setQuery((current) => ({ ...current, endAt: event.target.value }))}
            className={styles.input}
          />
        </label>
        <label className={styles.fieldLabel}>
          <span>操作</span>
          <button type="button" className="button-secondary" onClick={() => loadSeries(query, true)} disabled={isPending}>
            {isPending ? "加载中..." : "生成 / 刷新对比图"}
          </button>
        </label>
      </div>

      <div className={styles.inlineActions}>
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
                hours: preset.hours,
                startAt: "",
                endAt: "",
              };
              setQuery(nextQuery);
              loadSeries(nextQuery);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className={styles.metricChipRow}>
        {selectedMetrics.map((item) => (
          <button
            key={item.identifier}
            type="button"
            className={styles.metricChip}
            onClick={() => setSelectedMetricIds((current) => current.filter((identifier) => identifier !== item.identifier))}
          >
            <span className={styles.metricChipDot} style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
            <strong>移除</strong>
          </button>
        ))}
      </div>

      {error ? <div className={styles.notice}>{error}</div> : null}

      {preparedSeries.some((series) => series.points.length > 0) ? (
        <div className={styles.comparisonPanel}>
          <div className={styles.comparisonLegend}>
            {preparedSeries.map((series) => (
              <article key={series.identifier} className={styles.comparisonLegendCard}>
                <div className={styles.comparisonLegendHeader}>
                  <span className={styles.metricChipDot} style={{ backgroundColor: series.color }} />
                  <strong>{series.label}</strong>
                </div>
                <span>最新值 {formatChartMetricValue(series.identifier, series.latestPoint || undefined)}</span>
                <span>
                  区间 {series.minValue === null ? "--" : formatChartMetricValue(series.identifier, { timestamp: 0, value: series.minValue })} ~{" "}
                  {series.maxValue === null ? "--" : formatChartMetricValue(series.identifier, { timestamp: 0, value: series.maxValue })}
                </span>
              </article>
            ))}
          </div>

          <div className={styles.historyChartShell}>
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              className={styles.comparisonChart}
              role="img"
              aria-label="多指标叠加趋势图"
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
                setHoverRatio(ratio);
              }}
              onPointerLeave={() => setHoverRatio(null)}
            >
              {[0.25, 0.5, 0.75].map((ratio) => {
                const y = CHART_HEIGHT - CHART_PADDING_Y - ratio * (CHART_HEIGHT - CHART_PADDING_Y * 2);
                return (
                  <line
                    key={ratio}
                    x1={CHART_PADDING_X}
                    y1={y}
                    x2={CHART_WIDTH - CHART_PADDING_X}
                    y2={y}
                    className={styles.comparisonGridLine}
                  />
                );
              })}
              <line
                x1={CHART_PADDING_X}
                y1={CHART_PADDING_Y}
                x2={CHART_PADDING_X}
                y2={CHART_HEIGHT - CHART_PADDING_Y}
                className={styles.comparisonAxis}
              />
              <line
                x1={CHART_PADDING_X}
                y1={CHART_HEIGHT - CHART_PADDING_Y}
                x2={CHART_WIDTH - CHART_PADDING_X}
                y2={CHART_HEIGHT - CHART_PADDING_Y}
                className={styles.comparisonAxis}
              />
              {preparedSeries.map((series) => (
                <polyline
                  key={series.identifier}
                  points={series.polyline}
                  fill="none"
                  stroke={series.color}
                  strokeWidth="2.4"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {hoverRatio !== null ? (
                <line
                  x1={tooltipLeft}
                  y1={CHART_PADDING_Y}
                  x2={tooltipLeft}
                  y2={CHART_HEIGHT - CHART_PADDING_Y}
                  className={styles.historyHoverLine}
                />
              ) : null}
            </svg>

            {hoverRatio !== null && tooltipEntries.length ? (
              <div className={styles.comparisonTooltip} style={{ left: `${(tooltipLeft / CHART_WIDTH) * 100}%` }}>
                <strong>{tooltipTimestamp ? formatDateTime(tooltipTimestamp) : "当前时刻"}</strong>
                {tooltipEntries.map((item) => (
                  <div key={item.identifier} className={styles.comparisonTooltipRow}>
                    <span className={styles.metricChipDot} style={{ backgroundColor: item.color }} />
                    <span>{item.label}</span>
                    <strong>{formatChartMetricValue(item.identifier, item.point)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={styles.emptyState}>当前所选指标和时间范围内还没有可叠加的历史点。</div>
      )}
    </section>
  );
}
