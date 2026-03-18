"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { formatDateTime } from "@/lib/format";
import { findFieldByIdentifier, objectModelFields } from "@/lib/object-model";
import type { CurrentMetricValue, DashboardHistoryState, DashboardState, MetricHistoryPoint } from "@/lib/iot-platform";

type DashboardClientProps = {
  initialState: DashboardState;
};

type DashboardFilters = {
  environment: string;
  deviceSearch: string;
  fieldSearch: string;
  startAt: string;
  endAt: string;
  hours: number;
  metricId: string;
};

type PropertyRow = {
  functionId: string;
  name: string;
  identifier: string;
  shortCode: string;
  dataType: string;
  timestamp: number | null;
  value: string;
};

type OverviewItem = {
  label: string;
  value: string;
  hint?: string;
};

type ModalQuery = {
  deviceId: string;
  metricId: string;
  metricLabel: string;
  startAt: string;
  endAt: string;
  hours: number;
  environment: string;
};

type ModalMode = "chart" | "data";

function buildQueryString(params: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  return searchParams.toString();
}

function buildHistoryQueryString(query: Pick<ModalQuery, "environment" | "deviceId" | "metricId" | "startAt" | "endAt" | "hours">) {
  return buildQueryString({
    environment: query.environment,
    deviceId: query.deviceId,
    metricId: query.metricId,
    startAt: query.startAt,
    endAt: query.endAt,
    hours: query.hours,
  });
}

function formatBytes(bytes: number) {
  if (bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let value = bytes;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatMetricValue(point: MetricHistoryPoint | undefined) {
  return point ? `${point.value}` : "--";
}

function getFiltersFromState(state: DashboardState): DashboardFilters {
  return {
    environment: state.selectedEnvironment.key,
    deviceSearch: state.deviceSearch,
    fieldSearch: state.fieldSearch,
    startAt: state.startAt,
    endAt: state.endAt,
    hours: state.historyWindowHours,
    metricId: state.selectedMetricId || "",
  };
}

function getStateQuery(state: DashboardState) {
  return {
    environment: state.selectedEnvironment.key,
    deviceId: state.selectedDeviceId,
    metricId: state.selectedMetricId,
    deviceSearch: state.deviceSearch,
    fieldSearch: state.fieldSearch,
    startAt: state.startAt,
    endAt: state.endAt,
    hours: state.historyWindowHours,
  };
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="quec-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{hint}</em>
    </article>
  );
}

function OverviewCard({ label, value, hint }: OverviewItem) {
  return (
    <article className="device-info-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <em>{hint}</em> : null}
    </article>
  );
}

function pickMetric(currentValues: CurrentMetricValue[], identifiers: string[]) {
  return currentValues.find((value) => identifiers.includes(value.identifier));
}

function buildPropertyRows(currentValues: DashboardState["currentValues"]) {
  return currentValues
    .map((item) => {
      const field = findFieldByIdentifier(item.identifier);
      return {
        functionId: field?.functionId || "--",
        name: field?.name || item.label,
        identifier: item.identifier,
        shortCode: field?.shortCode || item.identifier,
        dataType: item.dataType,
        timestamp: item.timestamp,
        value: item.value,
      } satisfies PropertyRow;
    })
    .sort((left, right) => Number(left.functionId) - Number(right.functionId));
}

function getMetricByIdentifiers(currentValues: CurrentMetricValue[], identifiers: string[]) {
  return currentValues.find((item) => identifiers.includes(item.identifier));
}

function buildSoftwareVersionValue(currentValues: CurrentMetricValue[]) {
  const entries = [
    getMetricByIdentifiers(currentValues, ["BMSSWVer"]),
    getMetricByIdentifiers(currentValues, ["WIFISWVer"]),
    getMetricByIdentifiers(currentValues, ["ACSWVer"]),
    getMetricByIdentifiers(currentValues, ["DCSWVer"]),
  ].filter((item): item is CurrentMetricValue => item !== undefined);

  if (!entries.length) {
    return "--";
  }

  return entries.map((item) => `${item.label.replace("软件版本", "")}:${item.value}`).join(" / ");
}

function buildOnlineStatusValue(currentValues: CurrentMetricValue[]) {
  const onlineCount = getMetricByIdentifiers(currentValues, ["OnlNum"]);
  const networkStatus = getMetricByIdentifiers(currentValues, ["WIFISTS"]);

  if (onlineCount && typeof onlineCount.rawValue === "number") {
    return onlineCount.rawValue > 0 ? `在线 (${onlineCount.value})` : `离线 (${onlineCount.value})`;
  }

  if (networkStatus) {
    return `${networkStatus.label} ${networkStatus.value}`;
  }

  return "--";
}

function buildFaultStatusValue(currentValues: CurrentMetricValue[]) {
  const faults = currentValues.filter((item) =>
    ["EMSFault", "BF", "PromptFault", "ACFault1", "ACFault2", "DCFalut1", "DCFalut2"].includes(item.identifier),
  );
  const activeFaults = faults.filter((item) => !["0", "0.00", "--"].includes(String(item.rawValue ?? item.value)));

  if (!activeFaults.length) {
    return "正常";
  }

  return activeFaults.map((item) => `${item.label}:${item.value}`).join(" / ");
}

function combineMetricValues(left?: CurrentMetricValue, right?: CurrentMetricValue) {
  const values = [left?.value, right?.value].filter((value) => Boolean(value && value !== "--"));
  return values.length ? values.join(" / ") : "--";
}

function buildDeviceOverviewItems(
  currentValues: CurrentMetricValue[],
  selectedDeviceId: string | null,
  recentDailySummaries: DashboardState["recentDailySummaries"],
) {
  const todayGeneration = getMetricByIdentifiers(currentValues, ["PVDailyENR"]);
  const totalOutputPower = getMetricByIdentifiers(currentValues, ["TotalOutP", "LoadP"]);
  const modeMetric = getMetricByIdentifiers(currentValues, ["SysSTS", "PARMode", "LoaclMode", "MeterMode"]);
  const commMetric = getMetricByIdentifiers(currentValues, ["WIFISTS", "WIFIRSSI"]);
  const batteryTemp = getMetricByIdentifiers(currentValues, ["BatT", "ShellT", "EnvT"]);
  const batteryVoltage = getMetricByIdentifiers(currentValues, ["BMSV", "BatV"]);
  const batteryCurrent = getMetricByIdentifiers(currentValues, ["BMSI", "BatI"]);
  const batteryPower = getMetricByIdentifiers(currentValues, ["BatP", "PB"]);
  const sohMetric = getMetricByIdentifiers(currentValues, ["SOH"]);
  const cycleMetric = getMetricByIdentifiers(currentValues, ["AveCycN", "MaxCycN"]);
  const versions = buildSoftwareVersionValue(currentValues);

  const systemInfo: OverviewItem[] = [
    { label: "主机名称", value: selectedDeviceId || "--", hint: "设备主键 / DeviceKey" },
    { label: "生产序列号", value: getMetricByIdentifiers(currentValues, ["SN", "BMSSN"])?.value || "--" },
    { label: "软件版本", value: versions, hint: "BMS / IOT / AC / DC" },
    { label: "在线状态", value: buildOnlineStatusValue(currentValues) },
    { label: "故障状态", value: buildFaultStatusValue(currentValues) },
    { label: "通信状态", value: commMetric ? `${commMetric.label} ${commMetric.value}` : "--" },
    { label: "电池温度", value: batteryTemp?.value || "--" },
    { label: "工作模式显示", value: modeMetric ? `${modeMetric.label} ${modeMetric.value}` : "--" },
    { label: "主机电池总压", value: batteryVoltage?.value || "--" },
    { label: "主机电流状态", value: batteryCurrent?.value || "--" },
    { label: "主机SOC容量状态", value: getMetricByIdentifiers(currentValues, ["SOC"])?.value || "--" },
    { label: "主机SOH", value: sohMetric?.value || "--" },
    { label: "主机循环次数", value: cycleMetric?.value || "--" },
    { label: "电池充放电功率", value: batteryPower?.value || "--" },
    { label: "逆变器充放电功率", value: totalOutputPower?.value || "--" },
  ];

  const pvRows: OverviewItem[] = [
    { label: "PV1功率 / 电压", value: combineMetricValues(getMetricByIdentifiers(currentValues, ["PV1P"]), getMetricByIdentifiers(currentValues, ["PV1V"])) },
    { label: "PV2功率 / 电压", value: combineMetricValues(getMetricByIdentifiers(currentValues, ["PV2P"]), getMetricByIdentifiers(currentValues, ["PV2V"])) },
    { label: "PV3功率 / 电压", value: combineMetricValues(getMetricByIdentifiers(currentValues, ["PV3P"]), getMetricByIdentifiers(currentValues, ["PV3V"])) },
    { label: "PV4功率 / 电压", value: combineMetricValues(getMetricByIdentifiers(currentValues, ["PV4P"]), getMetricByIdentifiers(currentValues, ["PV4V"])) },
  ];

  const overviewCards: OverviewItem[] = [
    { label: "工作模式", value: modeMetric ? `${modeMetric.label} ${modeMetric.value}` : "--", hint: "设备当前模式" },
    { label: "总电量显示", value: totalOutputPower?.value || "--", hint: "当前总输出功率" },
    {
      label: "近3天运行记录",
      value: `${recentDailySummaries.length || 0} 天`,
      hint: recentDailySummaries[0]?.lastReportedAt ? `最近上报 ${formatDateTime(recentDailySummaries[0].lastReportedAt)}` : "按天聚合",
    },
    { label: "功率波形图", value: totalOutputPower?.label || "趋势曲线", hint: "支持全周期拖拽" },
    { label: "累计发电量统计", value: todayGeneration?.value || "--", hint: "日累计发电量" },
  ];

  return {
    overviewCards,
    systemInfo,
    pvRows,
  };
}

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) {
      return;
    }

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [locked]);
}

function InteractiveHistoryChart({ points, metricLabel }: { points: MetricHistoryPoint[]; metricLabel: string }) {
  const mainWidth = 960;
  const mainHeight = 360;
  const overviewHeight = 92;
  const paddingX = 32;
  const paddingY = 24;
  const plotWidth = mainWidth - paddingX * 2;
  const minWindow = Math.min(12, Math.max(points.length > 1 ? 2 : 1, Math.floor(points.length / 8) || 1));
  const [windowRange, setWindowRange] = useState<[number, number]>([0, Math.max(points.length - 1, 0)]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dragMode, setDragMode] = useState<null | { type: "start" | "end" | "window"; anchorIndex: number; width: number }>(null);
  const overviewRef = useRef<SVGSVGElement | null>(null);
  const mainRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    setWindowRange([0, Math.max(points.length - 1, 0)]);
    setHoverIndex(null);
    setDragMode(null);
  }, [points]);

  useEffect(() => {
    if (!dragMode) {
      return;
    }

    function getIndexFromClientX(clientX: number) {
      const rect = overviewRef.current?.getBoundingClientRect();
      if (!rect || points.length <= 1) {
        return 0;
      }

      const scaledPadding = (paddingX / mainWidth) * rect.width;
      const plotLeft = rect.left + scaledPadding;
      const plotWidthPx = Math.max(rect.width - scaledPadding * 2, 1);
      const ratio = Math.min(1, Math.max(0, (clientX - plotLeft) / plotWidthPx));
      return Math.round(ratio * (points.length - 1));
    }

    function handlePointerMove(event: PointerEvent) {
      if (!dragMode) {
        return;
      }

      const nextIndex = getIndexFromClientX(event.clientX);

      setWindowRange((current) => {
        const [start, end] = current;
        if (dragMode.type === "start") {
          return [Math.max(0, Math.min(nextIndex, end - minWindow)), end];
        }

        if (dragMode.type === "end") {
          return [start, Math.min(Math.max(nextIndex, start + minWindow), Math.max(points.length - 1, 0))];
        }

        const maxStart = Math.max(points.length - 1 - dragMode.width, 0);
        const nextStart = Math.min(Math.max(nextIndex - dragMode.anchorIndex, 0), maxStart);
        return [nextStart, Math.min(nextStart + dragMode.width, Math.max(points.length - 1, 0))];
      });
    }

    function handlePointerUp() {
      setDragMode(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragMode, minWindow, points.length]);

  const clampedRange = useMemo<[number, number]>(() => {
    const [start, end] = windowRange;
    const safeStart = Math.max(0, Math.min(start, Math.max(points.length - 1, 0)));
    const safeEnd = Math.max(safeStart, Math.min(end, Math.max(points.length - 1, 0)));
    return [safeStart, safeEnd];
  }, [points.length, windowRange]);

  const visiblePoints = useMemo(() => {
    const [start, end] = clampedRange;
    return points.slice(start, end + 1);
  }, [clampedRange, points]);

  if (!points.length) {
    return <div className="empty-state">当前筛选条件下没有可展示的趋势数据。</div>;
  }

  function buildChartPath(input: MetricHistoryPoint[], width: number, height: number) {
    const minValue = Math.min(...input.map((point) => point.value));
    const maxValue = Math.max(...input.map((point) => point.value));
    const range = maxValue - minValue || 1;

    const coordinates = input.map((point, index) => {
      const x = paddingX + (index / Math.max(input.length - 1, 1)) * (width - paddingX * 2);
      const y = height - paddingY - ((point.value - minValue) / range) * (height - paddingY * 2);
      return { x, y, point };
    });

    return {
      coordinates,
      polyline: coordinates.map((coordinate) => `${coordinate.x},${coordinate.y}`).join(" "),
    };
  }

  const mainChart = buildChartPath(visiblePoints, mainWidth, mainHeight);
  const overviewChart = buildChartPath(points, mainWidth, overviewHeight);
  const latestPoint = visiblePoints[visiblePoints.length - 1];
  const hoveredPoint =
    hoverIndex !== null && hoverIndex >= 0 && hoverIndex < visiblePoints.length ? mainChart.coordinates[hoverIndex] : null;

  function handleMainPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!mainRef.current || visiblePoints.length === 0) {
      return;
    }

    const rect = mainRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(ratio * Math.max(visiblePoints.length - 1, 0)));
  }

  function handleOverviewPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!overviewRef.current || points.length <= 1) {
      return;
    }

    event.preventDefault();
    const rect = overviewRef.current.getBoundingClientRect();
    const scaledPadding = (paddingX / mainWidth) * rect.width;
    const plotLeft = rect.left + scaledPadding;
    const plotWidthPx = Math.max(rect.width - scaledPadding * 2, 1);
    const ratio = Math.min(1, Math.max(0, (event.clientX - plotLeft) / plotWidthPx));
    const index = Math.round(ratio * (points.length - 1));
    const [start, end] = clampedRange;
    const width = Math.max(end - start, minWindow);
    const startRatio = start / Math.max(points.length - 1, 1);
    const endRatio = end / Math.max(points.length - 1, 1);
    const startX = plotLeft + startRatio * plotWidthPx;
    const endX = plotLeft + endRatio * plotWidthPx;
    const nearLeft = Math.abs(event.clientX - startX) <= 14;
    const nearRight = Math.abs(event.clientX - endX) <= 14;
    const insideWindow = event.clientX >= startX && event.clientX <= endX;

    if (nearLeft) {
      setDragMode({ type: "start", anchorIndex: 0, width });
      return;
    }

    if (nearRight) {
      setDragMode({ type: "end", anchorIndex: 0, width });
      return;
    }

    if (insideWindow) {
      setDragMode({ type: "window", anchorIndex: index - start, width });
      return;
    }

    const nextStart = Math.min(Math.max(index - Math.floor(width / 2), 0), Math.max(points.length - 1 - width, 0));
    setWindowRange([nextStart, Math.min(nextStart + width, Math.max(points.length - 1, 0))]);
  }

  const selectionStartX = paddingX + (clampedRange[0] / Math.max(points.length - 1, 1)) * plotWidth;
  const selectionEndX = paddingX + (clampedRange[1] / Math.max(points.length - 1, 1)) * plotWidth;

  return (
    <div className="history-chart-shell">
      <div className="trend-meta trend-meta-modal">
        <div>
          <span className="panel-kicker">趋势指标</span>
          <strong>{metricLabel}</strong>
        </div>
        <div>
          <span className="panel-kicker">最新值</span>
          <strong>{formatMetricValue(latestPoint)}</strong>
        </div>
        <div>
          <span className="panel-kicker">窗口</span>
          <strong>
            {formatDateTime(visiblePoints[0]?.timestamp)} - {formatDateTime(latestPoint?.timestamp)}
          </strong>
        </div>
      </div>

      <div className="history-chart-main">
        <svg
          ref={mainRef}
          viewBox={`0 0 ${mainWidth} ${mainHeight}`}
          className="trend-chart trend-chart-large"
          role="img"
          aria-label={`${metricLabel} 曲线`}
          onPointerMove={handleMainPointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="modal-trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(69, 112, 255, 0.32)" />
              <stop offset="100%" stopColor="rgba(69, 112, 255, 0.06)" />
            </linearGradient>
          </defs>
          <line x1={paddingX} y1={paddingY} x2={paddingX} y2={mainHeight - paddingY} className="trend-axis" />
          <line x1={paddingX} y1={mainHeight - paddingY} x2={mainWidth - paddingX} y2={mainHeight - paddingY} className="trend-axis" />
          <polyline
            points={`${paddingX},${mainHeight - paddingY} ${mainChart.polyline} ${mainWidth - paddingX},${mainHeight - paddingY}`}
            className="trend-area trend-area-main"
          />
          <polyline points={mainChart.polyline} fill="none" className="trend-line trend-line-main" />
          {mainChart.coordinates.map((coordinate) => (
            <circle key={`${coordinate.point.timestamp}`} cx={coordinate.x} cy={coordinate.y} r={2.8} className="trend-dot trend-dot-main" />
          ))}
          {hoveredPoint ? (
            <g>
              <line x1={hoveredPoint.x} y1={paddingY} x2={hoveredPoint.x} y2={mainHeight - paddingY} className="history-hover-line" />
              <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={5.4} className="history-hover-dot" />
            </g>
          ) : null}
        </svg>
        {hoveredPoint ? (
          <div className="history-tooltip" style={{ left: `${(hoveredPoint.x / mainWidth) * 100}%`, top: `${(hoveredPoint.y / mainHeight) * 100}%` }}>
            <strong>{hoveredPoint.point.value}</strong>
            <span>{formatDateTime(hoveredPoint.point.timestamp)}</span>
          </div>
        ) : null}
      </div>

      <div className="history-overview-shell">
        <div className="history-overview-header">
          <span>时间窗口拖拽筛选</span>
          <strong>
            {formatDateTime(visiblePoints[0]?.timestamp)} - {formatDateTime(visiblePoints[visiblePoints.length - 1]?.timestamp)}
          </strong>
        </div>
        <svg
          ref={overviewRef}
          viewBox={`0 0 ${mainWidth} ${overviewHeight}`}
          className="history-overview-chart"
          role="presentation"
          onPointerDown={handleOverviewPointerDown}
        >
          <polyline points={overviewChart.polyline} fill="none" className="history-overview-line" />
          <rect x={selectionStartX} y={8} width={Math.max(selectionEndX - selectionStartX, 8)} height={overviewHeight - 16} className="history-overview-selection" />
          <rect x={selectionStartX - 5} y={8} width={10} height={overviewHeight - 16} className="history-overview-handle" />
          <rect x={selectionEndX - 5} y={8} width={10} height={overviewHeight - 16} className="history-overview-handle" />
        </svg>
      </div>
    </div>
  );
}

function MetricHistoryModal({
  open,
  loading,
  error,
  metricLabel,
  deviceId,
  mode,
  query,
  points,
  onClose,
  onModeChange,
  onQueryChange,
  onRefresh,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  metricLabel: string;
  deviceId: string;
  mode: ModalMode;
  query: ModalQuery | null;
  points: MetricHistoryPoint[];
  onClose: () => void;
  onModeChange: (mode: ModalMode) => void;
  onQueryChange: (nextQuery: ModalQuery) => void;
  onRefresh: () => void;
}) {
  useBodyScrollLock(open);

  if (!open) {
    return null;
  }

  const sortedRows = [...points].sort((left, right) => right.timestamp - left.timestamp);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card history-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="panel-kicker">查看曲线</span>
            <h3>
              {metricLabel} · {deviceId}
            </h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {loading ? <div className="empty-state">正在加载曲线数据...</div> : null}
        {!loading && error ? <div className="notice notice-warning">{error}</div> : null}
        {!loading && !error ? <InteractiveHistoryChart points={points} metricLabel={metricLabel} /> : null}
      </div>
    </div>
  );
}

function MetricInsightModal({
  open,
  loading,
  error,
  metricLabel,
  deviceId,
  mode,
  query,
  points,
  onClose,
  onModeChange,
  onQueryChange,
  onApplyQuery,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  metricLabel: string;
  deviceId: string;
  mode: ModalMode;
  query: ModalQuery | null;
  points: MetricHistoryPoint[];
  onClose: () => void;
  onModeChange: (mode: ModalMode) => void;
  onQueryChange: (nextQuery: ModalQuery) => void;
  onApplyQuery: (nextQuery: ModalQuery) => void;
}) {
  useBodyScrollLock(open);

  if (!open) {
    return null;
  }

  const sortedRows = [...points].sort((left, right) => right.timestamp - left.timestamp);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card history-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="panel-kicker">查看指标</span>
            <h3>
              {metricLabel} · {deviceId}
            </h3>
          </div>
          <div className="modal-header-actions">
            <div className="modal-tab-switch">
              <button type="button" className={mode === "chart" ? "button-primary" : "button-secondary"} onClick={() => onModeChange("chart")}>
                查看曲线
              </button>
              <button type="button" className={mode === "data" ? "button-primary" : "button-secondary"} onClick={() => onModeChange("data")}>
                查看数据
              </button>
            </div>
            <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
              ×
            </button>
          </div>
        </div>
        {query ? (
          <div className="metric-modal-filter-row">
            <div className="metric-modal-presets">
              {[
                { label: "24小时", hours: 24 },
                { label: "3天", hours: 72 },
                { label: "7天", hours: 168 },
                { label: "全周期", hours: 0 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={query.hours === preset.hours && !query.startAt && !query.endAt ? "button-primary" : "button-secondary"}
                  onClick={() => {
                    const nextQuery = {
                      ...query,
                      hours: preset.hours,
                      startAt: "",
                      endAt: "",
                    };
                    onQueryChange(nextQuery);
                    onApplyQuery(nextQuery);
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <label className="field-shell">
              <span>开始时间</span>
              <input type="datetime-local" value={query.startAt} onChange={(event) => onQueryChange({ ...query, startAt: event.target.value })} className="power-input" />
            </label>
            <label className="field-shell">
              <span>结束时间</span>
              <input type="datetime-local" value={query.endAt} onChange={(event) => onQueryChange({ ...query, endAt: event.target.value })} className="power-input" />
            </label>
            <button type="button" className="button-primary" onClick={() => onApplyQuery(query)}>
              刷新
            </button>
          </div>
        ) : null}
        {loading ? <div className="empty-state">正在加载指标数据...</div> : null}
        {!loading && error ? <div className="notice notice-warning">{error}</div> : null}
        {!loading && !error && mode === "chart" ? <InteractiveHistoryChart points={points} metricLabel={metricLabel} /> : null}
        {!loading && !error && mode === "data" ? (
          <div className="table-shell modal-table-shell">
            <table className="quec-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>数值</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((point) => (
                  <tr key={`${point.timestamp}-${point.value}`}>
                    <td>{formatDateTime(point.timestamp)}</td>
                    <td>{point.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sortedRows.length === 0 ? <div className="empty-state">当前条件下没有可展示的数据点。</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DashboardClient({ initialState }: DashboardClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState(initialState);
  const [filters, setFilters] = useState(() => getFiltersFromState(initialState));
  const [isPending, startTransition] = useTransition();
  const stateCacheRef = useRef(new Map<string, DashboardState>());
  const historyCacheRef = useRef(new Map<string, DashboardHistoryState>());
  const [modalQuery, setModalQuery] = useState<ModalQuery | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>("chart");
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalPoints, setModalPoints] = useState<MetricHistoryPoint[]>([]);
  const [modalRawPoints, setModalRawPoints] = useState<MetricHistoryPoint[]>([]);

  useEffect(() => {
    stateCacheRef.current.set(buildQueryString(getStateQuery(initialState)), initialState);
  }, [initialState]);

  useEffect(() => {
    setFilters(getFiltersFromState(state));
  }, [state]);

  const propertyRows = useMemo(() => buildPropertyRows(state.currentValues), [state.currentValues]);
  const selectedMetric = state.metricOptions.find((metric) => metric.identifier === state.selectedMetricId);
  const topMetrics = [
    pickMetric(state.currentValues, ["SOC"]),
    pickMetric(state.currentValues, ["TotalOutP", "LoadP"]),
    pickMetric(state.currentValues, ["GridP"]),
  ].filter((item): item is CurrentMetricValue => item !== undefined);
  const deviceOverview = useMemo(
    () => buildDeviceOverviewItems(state.currentValues, state.selectedDeviceId, state.recentDailySummaries),
    [state.currentValues, state.recentDailySummaries, state.selectedDeviceId],
  );
  const selectedDeviceLastReportedAt = useMemo(() => {
    const latestMetricTimestamp = state.currentValues.reduce<number | null>((latest, item) => {
      if (!item.timestamp) {
        return latest;
      }

      return latest === null || item.timestamp > latest ? item.timestamp : latest;
    }, null);

    return latestMetricTimestamp || state.selectedDevice?.lastSeen || null;
  }, [state.currentValues, state.selectedDevice?.lastSeen]);
  const recentObjects = state.recentObjects.filter((object) => object.key.startsWith("iot-data/")).length
    ? state.recentObjects.filter((object) => object.key.startsWith("iot-data/"))
    : state.recentObjects;
  const primaryBucket = state.selectedEnvironment.buckets[0] || "--";
  const sourceModeLabel =
    state.dataSourceMode === "s3" ? "S3 实时读取" : state.dataSourceMode === "local" ? "本地兜底目录" : "待接入";
  const sourceModeHint =
    state.dataSourceMode === "s3"
      ? `${primaryBucket}/iot-data/`
      : state.dataSourceMode === "local"
        ? "S3 不可用时自动切换"
        : "请检查 AWS 凭证";
  const selectedDeviceParams = {
    environment: state.selectedEnvironment.key,
    metricId: state.selectedMetricId,
    deviceSearch: state.deviceSearch,
    fieldSearch: state.fieldSearch,
    startAt: state.startAt,
    endAt: state.endAt,
    hours: state.historyWindowHours,
  };
  const exportCurrentCsvHref = `/api/dashboard/export?${buildQueryString({
    ...selectedDeviceParams,
    deviceId: state.selectedDeviceId,
    dataset: "current",
    format: "csv",
  })}`;
  const exportHistoryCsvHref = `/api/dashboard/export?${buildQueryString({
    ...selectedDeviceParams,
    deviceId: state.selectedDeviceId,
    dataset: "history",
    format: "csv",
  })}`;

  async function fetchState(params: Record<string, string | number | null | undefined>, mutatePageState = true) {
    const queryString = buildQueryString(params);
    const cached = stateCacheRef.current.get(queryString);

    if (cached) {
      if (mutatePageState) {
        setState(cached);
        router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
      }
      return cached;
    }

    const response = await fetch(`/api/dashboard/state?${queryString}`, {
      method: "GET",
      credentials: "same-origin",
    });

    if (!response.ok) {
      throw new Error("加载设备数据失败。");
    }

    const nextState = (await response.json()) as DashboardState;
    stateCacheRef.current.set(queryString, nextState);

    if (mutatePageState) {
      setState(nextState);
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    }

    return nextState;
  }

  function updatePage(params: Record<string, string | number | null | undefined>) {
    startTransition(() => {
      void fetchState(params, true).catch(() => {
        // Keep the current UI state if refresh fails.
      });
    });
  }

  function handleDeviceSelect(deviceId: string) {
    updatePage({
      environment: filters.environment,
      deviceId,
      metricId: filters.metricId || state.selectedMetricId,
      deviceSearch: filters.deviceSearch,
      fieldSearch: filters.fieldSearch,
      startAt: filters.startAt,
      endAt: filters.endAt,
      hours: filters.hours,
    });
  }

  function handleApplyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updatePage({
      environment: filters.environment,
      deviceId: state.selectedDeviceId,
      metricId: filters.metricId || state.selectedMetricId,
      deviceSearch: filters.deviceSearch,
      fieldSearch: filters.fieldSearch,
      startAt: filters.startAt,
      endAt: filters.endAt,
      hours: filters.hours,
    });
  }

  function handleResetFilters() {
    const nextFilters = {
      environment: state.selectedEnvironment.key,
      deviceSearch: "",
      fieldSearch: "",
      startAt: "",
      endAt: "",
      hours: 24,
      metricId: state.selectedMetricId || "",
    };

    setFilters(nextFilters);
    updatePage({
      environment: state.selectedEnvironment.key,
      deviceId: state.selectedDeviceId,
      metricId: state.selectedMetricId,
      hours: 24,
    });
  }

  async function loadMetricHistory(query: ModalQuery) {
    const queryString = buildHistoryQueryString(query);
    setModalLoading(true);
    setModalError(null);

    try {
      const cached = historyCacheRef.current.get(queryString);
      const metricState =
        cached ||
        ((await fetch(`/api/dashboard/history?${queryString}`, {
          method: "GET",
          credentials: "same-origin",
        }).then(async (response) => {
          if (!response.ok) {
            throw new Error("加载指标失败。");
          }

          return (await response.json()) as DashboardHistoryState;
        })) as DashboardHistoryState);
      historyCacheRef.current.set(queryString, metricState);
      const nextPoints = metricState.rawHistorySeries.length ? metricState.rawHistorySeries : metricState.historySeries;
      setModalPoints(nextPoints);
      setModalRawPoints(metricState.rawHistorySeries);
      if (!nextPoints.length && metricState.notices.length > 0) {
        setModalError(metricState.notices[0]);
      }
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "加载指标失败。");
      setModalPoints([]);
      setModalRawPoints([]);
    } finally {
      setModalLoading(false);
    }
  }

  function handleModalQueryChange(nextQuery: ModalQuery) {
    setModalQuery(nextQuery);
    setModalError(null);
  }

  function handleApplyModalQuery(nextQuery: ModalQuery) {
    setModalQuery(nextQuery);
    void loadMetricHistory(nextQuery);
  }

  async function handleOpenMetricModal(row: PropertyRow, mode: ModalMode) {
    if (!state.selectedDeviceId) {
      return;
    }

    const query: ModalQuery = {
      environment: state.selectedEnvironment.key,
      deviceId: state.selectedDeviceId,
      metricId: row.identifier,
      startAt: mode === "data" ? "" : state.startAt,
      endAt: mode === "data" ? "" : state.endAt,
      hours: mode === "data" ? 0 : state.historyWindowHours,
      metricLabel: row.name,
    };
    const queryString = buildHistoryQueryString(query);

    setModalQuery(query);
    setModalMode(mode);
    setModalLoading(true);
    setModalError(null);

    try {
      if (row.identifier === state.selectedMetricId && state.historySeries.length > 0) {
        setModalPoints(state.historySeries);
        setModalRawPoints(state.historySeries);
      }

      const cached = historyCacheRef.current.get(queryString);
      const metricState =
        cached ||
        ((await fetch(`/api/dashboard/history?${queryString}`, {
          method: "GET",
          credentials: "same-origin",
        }).then(async (response) => {
          if (!response.ok) {
            throw new Error("加载曲线失败。");
          }

          return (await response.json()) as DashboardHistoryState;
        })) as DashboardHistoryState);
      historyCacheRef.current.set(queryString, metricState);
      const nextPoints = metricState.rawHistorySeries.length ? metricState.rawHistorySeries : metricState.historySeries;
      setModalPoints(nextPoints);
      setModalRawPoints(metricState.rawHistorySeries);
      if (!nextPoints.length && metricState.notices.length > 0) {
        setModalError(metricState.notices[0]);
      }
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "加载曲线失败。");
      setModalPoints([]);
      setModalRawPoints([]);
    } finally {
      setModalLoading(false);
    }
  }

  return (
    <>
      <main className="app-shell app-shell-wide quec-page">
        <section className="quec-toolbar">
          <div className="quec-toolbar-region">
            <span>数据来源</span>
            <strong>{state.selectedEnvironment.label}</strong>
          </div>
          <div className="quec-toolbar-breadcrumbs">
            <span>设备管理</span>
            <span>/</span>
            <strong>{state.selectedDeviceId ? "设备详情" : "设备运维"}</strong>
            {isPending ? <span className="pending-chip">加载中</span> : null}
          </div>
        </section>

        {state.notices.length > 0 ? (
          <div className="notice notice-warning">
            {state.notices.map((notice) => (
              <div key={notice}>{notice}</div>
            ))}
          </div>
        ) : null}

        <section className="panel quec-panel">
          <div className="panel-header">
            <h1>设备列表</h1>
            <span className="panel-kicker">直连 {primaryBucket} / iot-data</span>
          </div>

          <div className="quec-summary-grid">
            <SummaryCard label="设备总数" value={String(state.deviceOptions.length)} hint="识别到的设备" />
            <SummaryCard label="当前字段数" value={String(state.currentValues.length)} hint="映射到物模型中文" />
            <SummaryCard label="历史点数" value={String(state.historySeries.length)} hint={selectedMetric?.label || "未选择趋势指标"} />
          </div>

          <form className="quec-filter-row" onSubmit={handleApplyFilters}>
            <label className="field-shell">
              <span>环境</span>
              <select value={filters.environment} onChange={(event) => setFilters((current) => ({ ...current, environment: event.target.value }))} className="family-select">
                {state.environments.map((environment) => (
                  <option key={environment.key} value={environment.key}>
                    {environment.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-shell">
              <span>设备检索</span>
              <input
                type="search"
                value={filters.deviceSearch}
                onChange={(event) => setFilters((current) => ({ ...current, deviceSearch: event.target.value }))}
                className="power-input"
                placeholder="按 DeviceKey 或设备名称搜索"
              />
            </label>
            <label className="field-shell">
              <span>字段检索</span>
              <input
                type="search"
                value={filters.fieldSearch}
                onChange={(event) => setFilters((current) => ({ ...current, fieldSearch: event.target.value }))}
                className="power-input"
                placeholder="请输入属性名称或标识符"
              />
            </label>
            <label className="field-shell">
              <span>趋势指标</span>
              <select value={filters.metricId} onChange={(event) => setFilters((current) => ({ ...current, metricId: event.target.value }))} className="family-select">
                {state.metricOptions.map((metric) => (
                  <option key={metric.identifier} value={metric.identifier}>
                    {metric.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="button-primary">
              搜索
            </button>
            <button type="button" className="button-secondary" onClick={handleResetFilters}>
              重置
            </button>
          </form>

          <div className="table-shell">
            <table className="quec-table">
              <thead>
                <tr>
                  <th>设备名称</th>
                  <th>DeviceKey</th>
                  <th>字段数</th>
                  <th>样本数</th>
                  <th>最后上报时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.deviceOptions.map((device) => (
                  <tr key={device.id} className={device.id === state.selectedDeviceId ? "table-row-active" : undefined}>
                    <td>{device.label}</td>
                    <td>{device.id}</td>
                    <td>{device.metricCount}</td>
                    <td>{device.objectCount}</td>
                    <td>{formatDateTime(device.lastSeen)}</td>
                    <td>
                      <button type="button" className="table-link table-link-button" onClick={() => handleDeviceSelect(device.id)}>
                        查看
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {state.deviceOptions.length === 0 ? <div className="empty-state">当前没有识别到设备。</div> : null}
          </div>
        </section>

        {state.selectedDevice ? (
          <section className="panel quec-panel">
            <div className="quec-device-head">
              <div className="quec-device-avatar">{state.selectedDevice.id.slice(-4)}</div>
              <div className="quec-device-copy">
                <div className="quec-device-title-row">
                  <h2>{state.selectedDevice.id}</h2>
                  <span className="status-pill status-pill-live">已加载</span>
                  <span className="status-pill status-pill-muted">{state.selectedEnvironment.label}</span>
                </div>
                <div className="quec-device-meta">
                  <span>DeviceKey: {state.selectedDevice.id}</span>
                  <span>最后上报: {formatDateTime(selectedDeviceLastReportedAt)}</span>
                  <span>样本数: {state.selectedDevice.objectCount}</span>
                  <span>物模型字段: {state.currentValues.length}</span>
                </div>
              </div>
              <div className="quec-device-actions">
                <a href={exportCurrentCsvHref} className="button-secondary button-link">
                  导出属性
                </a>
                <a href={exportHistoryCsvHref} className="button-secondary button-link">
                  导出趋势
                </a>
              </div>
            </div>

            <div className="quec-tab-row">
              <a href="#device-overview" className="quec-tab-row-item quec-tab-row-item-active">
                运行概览
              </a>
              <a href="#system-info" className="quec-tab-row-item">
                整机信息
              </a>
              <a href="#property-log" className="quec-tab-row-item">
                属性日志
              </a>
              <a href="#trend-panel" className="quec-tab-row-item">
                趋势概览
              </a>
              <a href="#daily-records" className="quec-tab-row-item">
                近3天记录
              </a>
              <a href="#raw-files" className="quec-tab-row-item">
                原始数据
              </a>
            </div>

            <div className="quec-kpi-row">
              {topMetrics.map((metric) => (
                <article key={metric.identifier} className="quec-mini-card">
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <em>{formatDateTime(metric.timestamp)}</em>
                </article>
              ))}
            </div>

            <section id="device-overview" className="quec-subsection">
              <div className="panel-header">
                <h3>运行看板</h3>
                <span className="panel-kicker">参考整机信息卡片展示</span>
              </div>
              <div className="device-overview-grid">
                {deviceOverview.overviewCards.map((item) => (
                  <OverviewCard key={item.label} {...item} />
                ))}
              </div>
            </section>

            <section id="system-info" className="quec-subsection">
              <div className="panel-header">
                <h3>整机信息</h3>
                <span className="panel-kicker">按物模型中文字段聚合展示</span>
              </div>
              <div className="device-info-grid">
                {deviceOverview.systemInfo.map((item) => (
                  <OverviewCard key={item.label} {...item} />
                ))}
              </div>
            </section>

            <section className="quec-subsection">
              <div className="panel-header">
                <h3>PV 与电池信息</h3>
                <span className="panel-kicker">功率、电压、容量与循环状态</span>
              </div>
              <div className="device-info-grid">
                {deviceOverview.pvRows.map((item) => (
                  <OverviewCard key={item.label} {...item} />
                ))}
              </div>
            </section>

            <section id="property-log" className="quec-subsection">
              <div className="panel-header">
                <h3>属性日志</h3>
                <span className="panel-kicker">{propertyRows.length} 条属性</span>
              </div>

              <form className="quec-detail-filter" onSubmit={handleApplyFilters}>
                <label className="field-shell">
                  <span>属性名称</span>
                  <input
                    type="search"
                    value={filters.fieldSearch}
                    onChange={(event) => setFilters((current) => ({ ...current, fieldSearch: event.target.value }))}
                    className="power-input"
                    placeholder="属性名称"
                  />
                </label>
                <label className="field-shell">
                  <span>开始时间</span>
                  <input type="datetime-local" value={filters.startAt} onChange={(event) => setFilters((current) => ({ ...current, startAt: event.target.value }))} className="power-input" />
                </label>
                <label className="field-shell">
                  <span>结束时间</span>
                  <input type="datetime-local" value={filters.endAt} onChange={(event) => setFilters((current) => ({ ...current, endAt: event.target.value }))} className="power-input" />
                </label>
                <button type="submit" className="button-primary">
                  搜索
                </button>
              </form>

              <div className="table-shell">
                <table className="quec-table">
                  <thead>
                    <tr>
                      <th>功能ID</th>
                      <th>属性名称</th>
                      <th>数据类型</th>
                      <th>标识符</th>
                      <th>更新时间</th>
                      <th>当前值</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {propertyRows.map((row) => (
                      <tr key={row.identifier}>
                        <td>{row.functionId}</td>
                        <td>{row.name}</td>
                        <td>{row.dataType}</td>
                        <td>{row.shortCode}</td>
                        <td>{formatDateTime(row.timestamp)}</td>
                        <td>{row.value}</td>
                        <td>
                          <button type="button" className="table-link table-link-button" onClick={() => void handleOpenMetricModal(row, "chart")}>
                            查看曲线
                          </button>
                          <button type="button" className="table-link table-link-button table-link-button-spaced" onClick={() => void handleOpenMetricModal(row, "data")}>
                            查看数据
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section id="trend-panel" className="quec-subsection">
              <div className="panel-header">
                <h3>趋势概览</h3>
                <span className="panel-kicker">{selectedMetric?.label || "请选择趋势指标"}</span>
              </div>
              <InteractiveHistoryChart points={state.historySeries} metricLabel={selectedMetric?.label || "未选择趋势指标"} />
            </section>

            <section id="daily-records" className="quec-subsection">
              <div className="panel-header">
                <h3>近 3 天运行记录</h3>
                <span className="panel-kicker">按天聚合最近样本与关键能量指标</span>
              </div>
              <div className="table-shell">
                <table className="quec-table daily-summary-table">
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>最后上报</th>
                      <th>样本数</th>
                      <th>当日发电量</th>
                      <th>电网充电量</th>
                      <th>峰值输出功率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.recentDailySummaries.map((summary) => (
                      <tr key={summary.day}>
                        <td>{summary.day}</td>
                        <td>{formatDateTime(summary.lastReportedAt)}</td>
                        <td>{summary.sampleCount}</td>
                        <td>{summary.generation}</td>
                        <td>{summary.gridCharge}</td>
                        <td>{summary.peakOutputPower}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {state.recentDailySummaries.length === 0 ? <div className="empty-state">当前还没有可展示的近 3 天运行记录。</div> : null}
              </div>
            </section>

            <section id="raw-files" className="quec-subsection">
              <div className="panel-header">
                <h3>原始数据文件</h3>
                <span className="panel-kicker">仅展示近期已解析样本</span>
              </div>
              <div className="quec-file-list">
                {recentObjects.slice(0, 8).map((object) => (
                  <article key={`${object.bucket}:${object.key}`} className="quec-file-item">
                    <div>
                      <strong>{object.deviceId || "未识别设备"}</strong>
                      <p>{object.key}</p>
                    </div>
                    <div className="quec-file-meta">
                      <span>{formatBytes(object.size)}</span>
                      <span>{formatDateTime(object.lastModified)}</span>
                    </div>
                  </article>
                ))}
                {recentObjects.length === 0 ? <div className="empty-state">当前没有匹配的原始文件。</div> : null}
              </div>
            </section>
          </section>
        ) : null}

        <section className="panel quec-panel quec-helper-panel">
          <div className="panel-header">
            <h2>当前接入</h2>
            <span className="panel-kicker">默认直连 S3，必要时才回退本地目录</span>
          </div>
          <p className="panel-copy">
            当前页面优先直连
            <code> s3://{primaryBucket}/iot-data/</code>
            读取设备上报 JSON，并直接按物模型中文生成设备列表、属性日志和趋势图。本地目录只作为兜底，不再是默认入口。
          </p>
          <div className="quec-helper-grid">
            <SummaryCard label="接入模式" value={sourceModeLabel} hint={sourceModeHint} />
            <SummaryCard label="已映射字段" value={String(state.currentValues.length)} hint={`总物模型 ${objectModelFields.length} 项`} />
            <SummaryCard label="当前趋势指标" value={selectedMetric?.label || "--"} hint="属性表中可切换" />
          </div>
        </section>
      </main>

      <MetricInsightModal
        open={Boolean(modalQuery)}
        loading={modalLoading}
        error={modalError}
        metricLabel={modalQuery?.metricLabel || "趋势曲线"}
        deviceId={modalQuery?.deviceId || state.selectedDeviceId || "--"}
        mode={modalMode}
        query={modalQuery}
        points={modalRawPoints.length ? modalRawPoints : modalPoints}
        onModeChange={setModalMode}
        onQueryChange={handleModalQueryChange}
        onApplyQuery={handleApplyModalQuery}
        onClose={() => {
          setModalQuery(null);
          setModalMode("chart");
          setModalError(null);
          setModalPoints([]);
          setModalRawPoints([]);
        }}
      />
    </>
  );
}
