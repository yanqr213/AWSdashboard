import { formatDateTime } from "@/lib/format";
import { findFieldByIdentifier, formatScaledFieldNumericValue, objectModelFields, scaleFieldNumericValue } from "@/lib/object-model";
import type { CurrentMetricValue, DecodedFaultEntry, MetricHistoryPoint, RecentDailySummary } from "@/lib/iot-platform";

export type OverviewItem = {
  label: string;
  value: string;
  hint?: string;
};

export type KeyMetricCard = {
  label: string;
  value: string;
  hint: string;
  identifier: string | null;
  metricLabel: string;
  isAvailable: boolean;
};

export type PropertyRow = {
  functionId: string;
  name: string;
  identifier: string;
  shortCode: string;
  dataType: string;
  module: string;
  timestamp: number | null;
  value: string;
  isReported: boolean;
};

export type PropertyCategoryTab = {
  key: string;
  label: string;
  count: number;
};

const METRIC_IDENTIFIER_GROUPS = {
  soc: ["SOC", "SC0", "SOCi"],
  pv1Power: ["PV1P", "PV1"],
  pv2Power: ["PV2P", "PV2"],
  pv3Power: ["PV3P", "PV3"],
  pv4Power: ["PV4P", "PV4"],
  batteryVoltage: ["BMSV", "BatV", "BV0", "BMSVi"],
  batteryTemperature: ["TI0", "MinTi", "BatT"],
  gridPower: ["GridP", "GP", "GridPSet", "GS"],
  acOutputPower: ["TotalOutP", "OP", "InvP"],
  offGridOutputPower: ["LoadP", "LP"],
} as const;

export function buildQueryString(params: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  return searchParams.toString();
}

export function getMetricByIdentifiers(currentValues: CurrentMetricValue[], identifiers: string[]) {
  return currentValues.find((item) => {
    return identifiers.includes(item.identifier) || identifiers.includes(item.canonicalIdentifier) || identifiers.includes(item.shortCode);
  });
}

function getScaledMetricEntries(
  currentValues: CurrentMetricValue[],
  predicate: (item: CurrentMetricValue) => boolean,
) {
  return currentValues
    .filter((item) => predicate(item) && typeof item.rawValue === "number")
    .map((item) => {
      const field = findFieldByIdentifier(item.identifier);
      const scaled = field ? scaleFieldNumericValue(field, item.rawValue as number) : null;
      return {
        item,
        scaled,
      };
    })
    .filter((entry): entry is { item: CurrentMetricValue; scaled: number } => entry.scaled !== null);
}

export function findMinimumBatteryTemperatureMetric(currentValues: CurrentMetricValue[]) {
  const minimumEntries = getScaledMetricEntries(currentValues, (item) => item.canonicalIdentifier === "MinTi").sort(
    (left, right) => left.scaled - right.scaled,
  );

  if (minimumEntries.length) {
    return minimumEntries[0].item;
  }

  return getMetricByIdentifiers(currentValues, ["BatT"]);
}

export function buildSoftwareVersionValue(currentValues: CurrentMetricValue[]) {
  const entries = [
    getMetricByIdentifiers(currentValues, ["BMSSWVer", "BMS0SWVer", "SWVeri"]),
    getMetricByIdentifiers(currentValues, ["BMS1SWVer"]),
    getMetricByIdentifiers(currentValues, ["BMS2SWVer"]),
    getMetricByIdentifiers(currentValues, ["BMS3SWVer"]),
    getMetricByIdentifiers(currentValues, ["BMS4SWVer"]),
    getMetricByIdentifiers(currentValues, ["BMS5SWVer"]),
    getMetricByIdentifiers(currentValues, ["WIFISWVer"]),
    getMetricByIdentifiers(currentValues, ["ACSWVer"]),
    getMetricByIdentifiers(currentValues, ["DCSWVer"]),
  ].filter((item): item is CurrentMetricValue => item !== undefined);

  if (!entries.length) {
    return "--";
  }

  return entries.map((item) => `${item.label.replace("软件版本", "")}:${item.value}`).join(" / ");
}

export function buildOnlineStatusValue(currentValues: CurrentMetricValue[]) {
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

export function buildFaultStatusValue(decodedFaults: DecodedFaultEntry[]) {
  if (!decodedFaults.length) {
    return "正常";
  }

  const preview = decodedFaults.slice(0, 2).map((item) => item.name || item.meaning).join(" / ");
  return decodedFaults.length > 2 ? `${decodedFaults.length} 项异常 (${preview} 等)` : `${decodedFaults.length} 项异常 (${preview})`;
}

export function getFaultSeverityTone(severity: string) {
  if (severity === "故障") {
    return "critical";
  }

  if (severity === "告警") {
    return "warning";
  }

  if (severity === "提示") {
    return "notice";
  }

  return "default";
}

function buildHeatingReferenceItem(currentValues: CurrentMetricValue[]) {
  const rankedEntries = getScaledMetricEntries(currentValues, (item) => item.canonicalIdentifier === "MinTi").sort(
    (left, right) => left.scaled - right.scaled,
  );

  if (!rankedEntries.length) {
    return {
      label: "加热参考",
      value: "--",
      hint: "5℃ 开始 / 12℃ 停止",
    };
  }

  const minimumEntry = rankedEntries[0];
  if (!minimumEntry) {
    return {
      label: "加热参考",
      value: "--",
      hint: "5℃ 开始 / 12℃ 停止",
    };
  }

  const status = minimumEntry.scaled < 5 ? "已达加热阈值" : minimumEntry.scaled < 12 ? "回差区间" : "无需加热";
  return {
    label: "加热参考",
    value: status,
    hint: `${minimumEntry.item.label} ${minimumEntry.item.value} · 5℃ 开始 / 12℃ 停止`,
  };
}

export function buildDetailOverviewItems(
  currentValues: CurrentMetricValue[],
  recentDailySummaries: RecentDailySummary[],
  decodedFaults: DecodedFaultEntry[],
) {
  const totalOutputPower = getMetricByIdentifiers(currentValues, [
    ...METRIC_IDENTIFIER_GROUPS.acOutputPower,
    ...METRIC_IDENTIFIER_GROUPS.offGridOutputPower,
  ]);
  const modeMetric = getMetricByIdentifiers(currentValues, ["SysSTS", "PARMode", "LoaclMode", "MeterMode"]);
  const commMetric = getMetricByIdentifiers(currentValues, ["WIFISTS", "WIFIRSSI"]);
  const batteryTemp = findMinimumBatteryTemperatureMetric(currentValues);
  const batteryVoltage = getMetricByIdentifiers(currentValues, [...METRIC_IDENTIFIER_GROUPS.batteryVoltage]);
  const versions = buildSoftwareVersionValue(currentValues);
  const heatingReference = buildHeatingReferenceItem(currentValues);

  return [
    { label: "在线状态", value: buildOnlineStatusValue(currentValues), hint: commMetric ? `${commMetric.label} ${commMetric.value}` : "联网状态" },
    { label: "故障状态", value: buildFaultStatusValue(decodedFaults), hint: "当前激活故障" },
    { label: "软件版本", value: versions, hint: "BMS / IOT / AC / DC" },
    { label: "主机 SOC", value: getMetricByIdentifiers(currentValues, [...METRIC_IDENTIFIER_GROUPS.soc])?.value || "--", hint: "容量状态" },
    { label: "电池总压", value: batteryVoltage?.value || "--", hint: "主机电池总压" },
    { label: "电池最低温度", value: batteryTemp?.value || "--", hint: batteryTemp?.label || "最低电池温度" },
    heatingReference,
    { label: "当前输出", value: totalOutputPower?.value || "--", hint: "总输出功率" },
    { label: "工作模式", value: modeMetric ? `${modeMetric.label} ${modeMetric.value}` : "--", hint: "设备当前模式" },
    {
      label: "近 3 天记录",
      value: `${recentDailySummaries.length || 0} 天`,
      hint: recentDailySummaries[0]?.lastReportedAt ? `最近上报 ${formatDateTime(recentDailySummaries[0].lastReportedAt)}` : "按天聚合",
    },
  ] satisfies OverviewItem[];
}

function buildKeyMetricCard(
  currentValues: CurrentMetricValue[],
  identifiers: string[],
  label: string,
  fallbackHint: string,
) {
  const metric = getMetricByIdentifiers(currentValues, identifiers);

  return {
    label,
    value: metric?.value || "--",
    hint: metric ? `${metric.label} · 点击查看曲线` : fallbackHint,
    identifier: metric?.identifier || identifiers[0] || null,
    metricLabel: metric?.label || label,
    isAvailable: Boolean(metric?.identifier),
  } satisfies KeyMetricCard;
}

function buildBatteryTemperatureCard(currentValues: CurrentMetricValue[]) {
  const metric = findMinimumBatteryTemperatureMetric(currentValues);

  return {
    label: "电池最低温度",
    value: metric?.value || "--",
    hint: metric ? `${metric.label} · 点击查看曲线` : "当前没有电池最低温度",
    identifier: metric?.identifier || METRIC_IDENTIFIER_GROUPS.batteryTemperature[0] || null,
    metricLabel: metric?.label || "电池最低温度",
    isAvailable: Boolean(metric?.identifier),
  } satisfies KeyMetricCard;
}

export function buildKeyMetricCards(currentValues: CurrentMetricValue[]) {
  return [
    buildKeyMetricCard(currentValues, [...METRIC_IDENTIFIER_GROUPS.soc], "SOC", "当前没有 SOC 数据"),
    buildKeyMetricCard(currentValues, [...METRIC_IDENTIFIER_GROUPS.pv1Power], "PV1 输入功率", "当前没有 PV1 输入功率"),
    buildKeyMetricCard(currentValues, [...METRIC_IDENTIFIER_GROUPS.pv2Power], "PV2 输入功率", "当前没有 PV2 输入功率"),
    buildKeyMetricCard(currentValues, [...METRIC_IDENTIFIER_GROUPS.pv3Power], "PV3 输入功率", "当前没有 PV3 输入功率"),
    buildKeyMetricCard(currentValues, [...METRIC_IDENTIFIER_GROUPS.pv4Power], "PV4 输入功率", "当前没有 PV4 输入功率"),
    buildKeyMetricCard(currentValues, [...METRIC_IDENTIFIER_GROUPS.batteryVoltage], "电池电压", "当前没有电池电压"),
    buildBatteryTemperatureCard(currentValues),
    buildKeyMetricCard(currentValues, [...METRIC_IDENTIFIER_GROUPS.gridPower], "市电口功率", "当前没有市电口功率"),
    buildKeyMetricCard(currentValues, [...METRIC_IDENTIFIER_GROUPS.acOutputPower], "AC 输出功率", "当前没有 AC 输出功率"),
    buildKeyMetricCard(currentValues, [...METRIC_IDENTIFIER_GROUPS.offGridOutputPower], "离网输出功率", "当前没有离网输出功率"),
  ] satisfies KeyMetricCard[];
}

export function buildPropertyRows(currentValues: CurrentMetricValue[], includeObjectModelCatalog = false) {
  const rows: PropertyRow[] = currentValues
    .map((item) => {
      const field = findFieldByIdentifier(item.identifier);
      return {
        functionId: field?.functionId || "--",
        name: item.label,
        identifier: item.identifier,
        shortCode: item.identifier === item.canonicalIdentifier ? item.shortCode : `${item.shortCode} · ${item.canonicalIdentifier}`,
        dataType: item.dataType,
        module: item.module || "未分类",
        timestamp: item.timestamp,
        value: item.value,
        isReported: true,
      } satisfies PropertyRow;
    });

  if (includeObjectModelCatalog) {
    const directIdentifiers = new Set(rows.map((row) => row.identifier));
    const canonicalIdentifiers = new Set(currentValues.map((item) => item.canonicalIdentifier));

    for (const field of objectModelFields) {
      if (directIdentifiers.has(field.identifier) || canonicalIdentifiers.has(field.identifier)) {
        continue;
      }

      rows.push({
        functionId: field.functionId || "--",
        name: field.name,
        identifier: field.identifier,
        shortCode: field.shortCode || field.identifier,
        dataType: field.dataType,
        module: field.module || "未分类",
        timestamp: null,
        value: "--",
        isReported: false,
      });
    }
  }

  return rows.sort((left, right) => {
    const leftOrder = Number.parseInt(left.functionId, 10);
    const rightOrder = Number.parseInt(right.functionId, 10);
    if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.identifier.localeCompare(right.identifier);
  });
}

function getPropertyCategoryPriority(label: string) {
  const orderedLabels = ["EMS", "AC", "DC", "BMS总", "BMS单包", "IOT", "Wi-Fi", "未分类"];
  const index = orderedLabels.indexOf(label);
  return index === -1 ? orderedLabels.length : index;
}

export function buildPropertyCategoryTabs(rows: PropertyRow[]) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = row.module || "未分类";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const tabs = [...counts.entries()]
    .sort((left, right) => {
      return getPropertyCategoryPriority(left[0]) - getPropertyCategoryPriority(right[0]) || left[0].localeCompare(right[0]);
    })
    .map(([key, count]) => ({
      key,
      label: key,
      count,
    })) satisfies PropertyCategoryTab[];

  return [
    {
      key: "all",
      label: "全部",
      count: rows.length,
    },
    ...tabs,
  ] satisfies PropertyCategoryTab[];
}

export function getLatestMetricTimestamp(currentValues: CurrentMetricValue[], fallback: number | null) {
  const latestMetricTimestamp = currentValues.reduce<number | null>((latest, item) => {
    if (!item.timestamp) {
      return latest;
    }

    return latest === null || item.timestamp > latest ? item.timestamp : latest;
  }, null);

  return latestMetricTimestamp || fallback;
}

export function formatChartMetricValue(metricIdentifier: string | null, point: MetricHistoryPoint | undefined) {
  if (!point) {
    return "--";
  }

  const field = metricIdentifier ? findFieldByIdentifier(metricIdentifier) : null;
  return field ? formatScaledFieldNumericValue(field, point.value) : `${point.value}`;
}
