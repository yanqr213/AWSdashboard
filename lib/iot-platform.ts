import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type _Object as S3SdkObject,
} from "@aws-sdk/client-s3";

import {
  faultDefinitions,
  findFieldByIdentifier,
  findFieldsByIdentifier,
  formatScaledFieldNumericValue,
  getFieldDisplayUnit,
  getFieldDisplayName,
  getPreferredMetricIdentifiers,
  normalizeMetricKey,
  objectModelFields,
  objectModelModules,
  resolveMetricField,
  scaleFieldNumericValue,
  type FaultDefinition,
  type ObjectModelField,
} from "@/lib/object-model";

export type PlatformEnvironmentKey = "hk-test" | "de-prod";

export type PlatformEnvironment = {
  key: PlatformEnvironmentKey;
  label: string;
  region: string;
  note: string;
  buckets: string[];
  prefixHints: string[];
  publicBaseUrl: string | null;
};

export type PlatformObjectPreview = {
  source: "s3" | "local";
  bucket: string;
  key: string;
  size: number;
  lastModified: number | null;
  etag: string | null;
  storageClass: string | null;
  classification: "telemetry" | "shadow" | "ota-manifest" | "ota-binary" | "other";
  deviceId: string | null;
  url: string | null;
  localPath: string | null;
};

export type BucketPrefixStatus = {
  prefix: string;
  status: "ready" | "empty" | "denied" | "error" | "skipped";
  objectCount: number;
  sampleKey: string | null;
  message: string | null;
};

export type BucketStatus = {
  bucket: string;
  region: string;
  accessible: boolean;
  prefixes: BucketPrefixStatus[];
};

export type DeviceSummary = {
  id: string;
  label: string;
  productKey: string | null;
  modelLabel: string;
  objectCount: number;
  otaCount: number;
  metricCount: number;
  lastSeen: number | null;
  sampleKeys: string[];
};

export type CurrentMetricValue = {
  identifier: string;
  canonicalIdentifier: string;
  label: string;
  shortCode: string;
  module: string;
  access: string;
  dataType: string;
  unit: string;
  value: string;
  rawValue: string | number | boolean | null;
  timestamp: number | null;
  sourceKey: string;
};

export type MetricHistoryPoint = {
  timestamp: number;
  value: number;
};

export type DecodedFaultEntry = {
  group: string;
  groupBit: number | null;
  identifier: string;
  identifierBit: number | null;
  sourceIdentifier: string;
  sourceLabel: string;
  severity: string;
  code: string;
  category: string;
  display: string;
  name: string;
  meaning: string;
  description: string;
  nameEn: string;
  rawValue: number;
  rawHex: string;
  maskHex: string;
};

export type FaultHistoryEntry = DecodedFaultEntry & {
  timestamp: number;
  sourceKey: string;
};

export type OtaArtifact = {
  module: string;
  kind: "manifest" | "binary";
  version: string;
  bucket: string;
  key: string;
  deviceId: string | null;
  size: number;
  lastModified: number | null;
  url: string | null;
};

export type ModuleCoverage = {
  module: string;
  total: number;
  available: number;
  coverageRatio: number;
};

export type IngestionLane = {
  key: string;
  label: string;
  objectCount: number;
  detail: string;
};

export type PayloadPreview = {
  bucket: string;
  key: string;
  deviceId: string | null;
  timestamp: number | null;
  source: "json-body" | "base64-raw-data";
  classification: PlatformObjectPreview["classification"];
  fieldCount: number;
  metricCount: number;
  snippet: string;
};

export type QueryStats = {
  listRequests: number;
  objectFetches: number;
  objectsDiscovered: number;
  objectsParsed: number;
  bytesFetched: number;
  cacheHits: number;
  listBudget: number;
  fetchBudget: number;
};

export type RecentDailySummary = {
  day: string;
  sampleCount: number;
  lastReportedAt: number | null;
  generation: string;
  gridCharge: string;
  peakOutputPower: string;
};

export type DashboardConfigStatus = {
  hasAwsCredentials: boolean;
  hasBucketConfig: boolean;
  liveAccessReady: boolean;
};

export type DashboardFleetSummary = {
  totalDevices: number;
  model500Count: number;
  model500ProCount: number;
  latestReportedAt: number | null;
};

export type DashboardListState = {
  environments: PlatformEnvironment[];
  selectedEnvironment: PlatformEnvironment;
  dataSourceMode: "s3" | "local" | "none";
  deviceSearch: string;
  deviceType: "all" | "500" | "500PRO";
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  deviceOptions: DeviceSummary[];
  fleetSummary: DashboardFleetSummary;
  queryStats: QueryStats;
  configStatus: DashboardConfigStatus;
  notices: string[];
};

export type SupportFollowUpDevice = {
  id: string;
  label: string;
  modelLabel: string;
  metricCount: number;
  lastSeen: number | null;
  issueLevel: "high" | "medium" | "normal";
  issueLabel: string;
  actionHint: string;
};

export type SupportWorkbenchSummary = {
  totalDevices: number;
  activeWithin24Hours: number;
  stale24Hours: number;
  stale72Hours: number;
  neverReported: number;
  latestReportedAt: number | null;
};

export type SupportWorkbenchState = {
  environments: PlatformEnvironment[];
  selectedEnvironment: PlatformEnvironment;
  dataSourceMode: "s3" | "local" | "none";
  summary: SupportWorkbenchSummary;
  followUpDevices: SupportFollowUpDevice[];
  queryStats: QueryStats;
  configStatus: DashboardConfigStatus;
  notices: string[];
};

export type DashboardDetailState = {
  environments: PlatformEnvironment[];
  selectedEnvironment: PlatformEnvironment;
  dataSourceMode: "s3" | "local" | "none";
  selectedDeviceId: string | null;
  selectedDevice: DeviceSummary | null;
  selectedMetricId: string | null;
  historyWindowHours: number;
  currentValues: CurrentMetricValue[];
  decodedFaults: DecodedFaultEntry[];
  historySeries: MetricHistoryPoint[];
  metricOptions: Array<{ identifier: string; label: string }>;
  recentDailySummaries: RecentDailySummary[];
  queryStats: QueryStats;
  configStatus: DashboardConfigStatus;
  notices: string[];
};

export type DashboardState = {
  environments: PlatformEnvironment[];
  selectedEnvironment: PlatformEnvironment;
  dataSourceMode: "s3" | "local" | "none";
  selectedDeviceId: string | null;
  selectedMetricId: string | null;
  deviceSearch: string;
  fieldSearch: string;
  startAt: string;
  endAt: string;
  historyWindowHours: number;
  deviceOptions: DeviceSummary[];
  selectedDevice: DeviceSummary | null;
  currentValues: CurrentMetricValue[];
  decodedFaults: DecodedFaultEntry[];
  historySeries: MetricHistoryPoint[];
  metricOptions: Array<{ identifier: string; label: string }>;
  otaArtifacts: OtaArtifact[];
  recentObjects: PlatformObjectPreview[];
  moduleCoverage: ModuleCoverage[];
  bucketStatuses: BucketStatus[];
  ingestionLanes: IngestionLane[];
  payloadPreviews: PayloadPreview[];
  recentDailySummaries: RecentDailySummary[];
  queryStats: QueryStats;
  configStatus: DashboardConfigStatus;
  notices: string[];
};

export type DashboardHistoryState = {
  selectedEnvironment: PlatformEnvironment;
  dataSourceMode: "s3" | "local" | "none";
  selectedDeviceId: string | null;
  selectedMetricId: string | null;
  historySeries: MetricHistoryPoint[];
  rawHistorySeries: MetricHistoryPoint[];
  metricOptions: Array<{ identifier: string; label: string }>;
  queryStats: QueryStats;
  notices: string[];
};

export type DashboardFaultHistoryState = {
  selectedEnvironment: PlatformEnvironment;
  dataSourceMode: "s3" | "local" | "none";
  selectedDeviceId: string | null;
  historyWindowHours: number;
  startAt: string;
  endAt: string;
  faultHistory: FaultHistoryEntry[];
  queryStats: QueryStats;
  notices: string[];
};

type MetricSample = {
  identifier: string;
  canonicalIdentifier: string;
  label: string;
  shortCode: string;
  timestamp: number;
  value: string | number | boolean | null;
  sourceKey: string;
};

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

type ObjectTextPayload = {
  text: string;
  contentType: string | null;
};

type ExtractedPayload = {
  payload: unknown;
  source: PayloadPreview["source"];
};

type DeviceLiveSnapshotMap = Map<
  string,
  {
    metricCount: number;
    lastReportedAt: number | null;
    productKey: string | null;
  }
>;

export type DashboardQuery = {
  environment?: string;
  deviceId?: string;
  metricId?: string;
  deviceSearch?: string;
  deviceType?: string;
  fieldSearch?: string;
  startAt?: string;
  endAt?: string;
  hours?: number;
  page?: number;
  pageSize?: number;
};

declare global {
  var __sunlitIotCache: Map<string, CacheEntry> | undefined;
}

const DEVICE_ID_REGEX = /\bTB[A-Za-z0-9_-]{6,}\b/g;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const HONG_KONG_PREFIX_HINTS = ["iot-data/"];
const FRANKFURT_PREFIX_HINTS = ["iot-data/", "notify/", "ems/"];
const TIMESTAMP_KEYS = [
  "timestamp",
  "ts",
  "time",
  "reporttime",
  "reportedat",
  "updatedat",
  "lastupdated",
  "eventtime",
  "createdat",
  "datetime",
];
const LIST_BUDGET = 240;
const FETCH_BUDGET = 32;
const HISTORY_FETCH_BUDGET = 240;
const HISTORY_FETCH_OBJECTS_PER_DAY = 960;
const HISTORY_FETCH_MAX_BUDGET = 10_000;
const CACHE_TTL_MS = 60_000;
const MAX_OBJECT_BYTES = 1_500_000;
const MAX_HISTORY_POINTS = 360;
const DEFAULT_HISTORY_WINDOW_HOURS = 24;
const DEFAULT_LOCAL_DATA_ROOT = path.join(process.cwd(), ".local-data", "iot-downloads");
const LOCAL_FILE_LIMIT = 160;
const RECENT_IOT_DATE_LIMIT = 10;
const COMMON_PREFIX_LIMIT = 180;
const HISTORY_FULL_CYCLE_DATE_LIMIT = COMMON_PREFIX_LIMIT;
const SELECTED_DEVICE_OBJECTS_PER_DAY = 60;
const HISTORY_SELECTED_DEVICE_OBJECTS_PER_DAY = 960;
const DEVICE_KEY_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
const OBJECT_FETCH_CONCURRENCY = 8;
const METRIC_COUNT_CONCURRENCY = 6;

const sampleManifest = {
  deviceId: "TB744dbd38dc8c",
  bucket: "tuobang-iot-ota-dev",
  region: "ap-east-1",
  key: "TB744dbd38dc8c_20260212035800.json",
  modules: [
    {
      module: "ems",
      version: "TP-Sunlit-24-EMS_V1.1.1_16M_build3.bin",
      url: "https://tuobang-iot-ota-dev.s3.ap-east-1.amazonaws.com/ems/TP-Sunlit-24-EMS_V1.1.1_16M_build3.bin",
    },
    {
      module: "ac",
      version: "TP-Sunlit-24-ACM_V4.1.1.bin",
      url: "https://tuobang-iot-ota-dev.s3.ap-east-1.amazonaws.com/ac/TP-Sunlit-24-ACM_V4.1.1.bin",
    },
    {
      module: "dc",
      version: "TP-Sunlit-24-DCM_V4.1.1.bin",
      url: "https://tuobang-iot-ota-dev.s3.ap-east-1.amazonaws.com/dc/TP-Sunlit-24-DCM_V4.1.1.bin",
    },
  ],
};

function getCacheStore() {
  if (!globalThis.__sunlitIotCache) {
    globalThis.__sunlitIotCache = new Map();
  }

  return globalThis.__sunlitIotCache;
}

function readCache<T>(key: string) {
  const entry = getCacheStore().get(key);

  if (!entry || entry.expiresAt < Date.now()) {
    if (entry) {
      getCacheStore().delete(key);
    }

    return null;
  }

  return entry.value as T;
}

function writeCache<T>(key: string, value: T, ttlMs = CACHE_TTL_MS) {
  getCacheStore().set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
}

function createQueryStats(fetchBudget = FETCH_BUDGET): QueryStats {
  return {
    listRequests: 0,
    objectFetches: 0,
    objectsDiscovered: 0,
    objectsParsed: 0,
    bytesFetched: 0,
    cacheHits: 0,
    listBudget: LIST_BUDGET,
    fetchBudget,
  };
}

function buildDashboardConfigStatus(
  selectedEnvironment: PlatformEnvironment,
  bucketStatuses: BucketStatus[],
  localRootDir: string | null,
): DashboardConfigStatus {
  return {
    hasAwsCredentials: hasAwsCredentials(),
    hasBucketConfig: selectedEnvironment.buckets.length > 0 || Boolean(localRootDir),
    liveAccessReady: bucketStatuses.some((bucket) => bucket.accessible),
  };
}

function buildDashboardFleetSummary(deviceOptions: DeviceSummary[]): DashboardFleetSummary {
  return deviceOptions.reduce<DashboardFleetSummary>(
    (summary, device) => {
      if (device.modelLabel === "500") {
        summary.model500Count += 1;
      }

      if (device.modelLabel === "500PRO") {
        summary.model500ProCount += 1;
      }

      if (!summary.latestReportedAt || (device.lastSeen || 0) > summary.latestReportedAt) {
        summary.latestReportedAt = device.lastSeen;
      }

      return summary;
    },
    {
      totalDevices: deviceOptions.length,
      model500Count: 0,
      model500ProCount: 0,
      latestReportedAt: null,
    },
  );
}

function splitCsv(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSearchTerm(value: string | undefined) {
  return (value || "").trim();
}

function normalizeListDeviceType(value: string | undefined): "all" | "500" | "500PRO" {
  return value === "500" || value === "500PRO" ? value : "all";
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || (value || 0) < 1) {
    return fallback;
  }

  return Math.floor(value as number);
}

function buildSupportWorkbenchSummary(deviceOptions: DeviceSummary[]): SupportWorkbenchSummary {
  const now = Date.now();

  return deviceOptions.reduce<SupportWorkbenchSummary>(
    (summary, device) => {
      if (!summary.latestReportedAt || (device.lastSeen || 0) > summary.latestReportedAt) {
        summary.latestReportedAt = device.lastSeen;
      }

      if (!device.lastSeen) {
        summary.neverReported += 1;
        return summary;
      }

      const ageHours = (now - device.lastSeen) / (1000 * 60 * 60);
      if (ageHours <= 24) {
        summary.activeWithin24Hours += 1;
      }

      if (ageHours > 24) {
        summary.stale24Hours += 1;
      }

      if (ageHours > 72) {
        summary.stale72Hours += 1;
      }

      return summary;
    },
    {
      totalDevices: deviceOptions.length,
      activeWithin24Hours: 0,
      stale24Hours: 0,
      stale72Hours: 0,
      neverReported: 0,
      latestReportedAt: null,
    },
  );
}

function buildSupportFollowUpDevices(deviceOptions: DeviceSummary[]) {
  const now = Date.now();

  return [...deviceOptions]
    .map<SupportFollowUpDevice>((device) => {
      if (!device.lastSeen) {
        return {
          id: device.id,
          label: device.label,
          modelLabel: device.modelLabel,
          metricCount: device.metricCount,
          lastSeen: device.lastSeen,
          issueLevel: "high",
          issueLabel: "未发现上报",
          actionHint: "优先核对设备是否完成配网、激活以及站点供电。",
        };
      }

      const ageHours = (now - device.lastSeen) / (1000 * 60 * 60);
      if (ageHours > 72) {
        return {
          id: device.id,
          label: device.label,
          modelLabel: device.modelLabel,
          metricCount: device.metricCount,
          lastSeen: device.lastSeen,
          issueLevel: "high",
          issueLabel: "超 72 小时未上报",
          actionHint: "建议售后优先联系现场，检查供电、联网和逆变器工作状态。",
        };
      }

      if (ageHours > 24) {
        return {
          id: device.id,
          label: device.label,
          modelLabel: device.modelLabel,
          metricCount: device.metricCount,
          lastSeen: device.lastSeen,
          issueLevel: "medium",
          issueLabel: "超 24 小时未上报",
          actionHint: "建议客服先确认客户现场网络和设备在线状态。",
        };
      }

      if (device.metricCount < 15) {
        return {
          id: device.id,
          label: device.label,
          modelLabel: device.modelLabel,
          metricCount: device.metricCount,
          lastSeen: device.lastSeen,
          issueLevel: "medium",
          issueLabel: "字段偏少",
          actionHint: "建议确认物模型上报是否完整，必要时查看设备详情和历史数据。",
        };
      }

      return {
        id: device.id,
        label: device.label,
        modelLabel: device.modelLabel,
        metricCount: device.metricCount,
        lastSeen: device.lastSeen,
        issueLevel: "normal",
        issueLabel: "状态正常",
        actionHint: "可作为常规客服回访设备。",
      };
    })
    .sort((left, right) => {
      const severityOrder = { high: 0, medium: 1, normal: 2 } as const;
      if (severityOrder[left.issueLevel] !== severityOrder[right.issueLevel]) {
        return severityOrder[left.issueLevel] - severityOrder[right.issueLevel];
      }

      if (left.lastSeen === null && right.lastSeen !== null) {
        return -1;
      }

      if (left.lastSeen !== null && right.lastSeen === null) {
        return 1;
      }

      return (left.lastSeen || 0) - (right.lastSeen || 0);
    })
    .slice(0, 12);
}

function matchesSearch(value: string | null | undefined, searchTerm: string) {
  if (!searchTerm) {
    return true;
  }

  return (value || "").toLowerCase().includes(searchTerm.toLowerCase());
}

function parseDateTimeInput(value: string | undefined) {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasAwsCredentials() {
  return Boolean(process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim());
}

export function getEnvironmentDefinitions(): PlatformEnvironment[] {
  return [
    {
      key: "hk-test",
      label: "香港测试",
      region: process.env.AWS_IOT_TEST_REGION?.trim() || "ap-east-1",
      note: "测试环境",
      buckets: splitCsv(process.env.AWS_IOT_TEST_BUCKETS).length
        ? splitCsv(process.env.AWS_IOT_TEST_BUCKETS)
        : ["tuobang-iot-data-report-dev"],
      prefixHints: splitCsv(process.env.AWS_IOT_TEST_PREFIX_HINTS).length
        ? splitCsv(process.env.AWS_IOT_TEST_PREFIX_HINTS)
        : HONG_KONG_PREFIX_HINTS,
      publicBaseUrl: process.env.AWS_IOT_TEST_PUBLIC_BASE_URL?.trim() || null,
    },
    {
      key: "de-prod",
      label: "法兰克福正式",
      region: process.env.AWS_IOT_PROD_REGION?.trim() || "eu-central-1",
      note: "正式环境",
      buckets: splitCsv(process.env.AWS_IOT_PROD_BUCKETS).length
        ? splitCsv(process.env.AWS_IOT_PROD_BUCKETS)
        : ["tuobang-iot-data-report-prod", "tuobang-iot-ota-prod"],
      prefixHints: splitCsv(process.env.AWS_IOT_PROD_PREFIX_HINTS).length
        ? splitCsv(process.env.AWS_IOT_PROD_PREFIX_HINTS)
        : FRANKFURT_PREFIX_HINTS,
      publicBaseUrl: process.env.AWS_IOT_PROD_PUBLIC_BASE_URL?.trim() || null,
    },
  ];
}

function getSelectedEnvironment(query: DashboardQuery, environments: PlatformEnvironment[]) {
  const fallback = environments[0];
  return environments.find((environment) => environment.key === query.environment) || fallback;
}

function getConfiguredLocalDataDir(environmentKey: PlatformEnvironmentKey) {
  const specific =
    environmentKey === "hk-test"
      ? process.env.LOCAL_IOT_TEST_DATA_DIR?.trim()
      : process.env.LOCAL_IOT_PROD_DATA_DIR?.trim();

  if (specific) {
    return path.resolve(specific);
  }

  const root = process.env.LOCAL_IOT_DATA_ROOT?.trim()
    ? path.resolve(process.env.LOCAL_IOT_DATA_ROOT.trim())
    : DEFAULT_LOCAL_DATA_ROOT;

  return path.join(root, environmentKey);
}

async function directoryExists(targetPath: string) {
  try {
    await access(targetPath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function classifyLocalObjectKey(key: string): PlatformObjectPreview["classification"] {
  const classified = classifyObjectKey(key);
  if (classified !== "other") {
    return classified;
  }

  return /\.(bin|rbl|hex|img)$/i.test(key) ? "ota-binary" : "telemetry";
}

async function collectLocalFilePaths(rootDir: string, limit: number) {
  const filePaths: string[] = [];

  async function walk(currentDir: string) {
    if (filePaths.length >= limit) {
      return;
    }

    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (filePaths.length >= limit) {
        return;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.isFile()) {
        filePaths.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return filePaths;
}

async function listLocalObjects(environment: PlatformEnvironment) {
  const localRootDir = getConfiguredLocalDataDir(environment.key);
  if (!(await directoryExists(localRootDir))) {
    return {
      objects: [] as PlatformObjectPreview[],
      bucketStatuses: [] as BucketStatus[],
      localRootDir: null as string | null,
    };
  }

  const filePaths = await collectLocalFilePaths(localRootDir, LOCAL_FILE_LIMIT);
  const objects = await Promise.all(
    filePaths.map(async (filePath) => {
      const fileStat = await stat(filePath);
      const relativeKey = path.relative(localRootDir, filePath).split(path.sep).join("/");

      return {
        source: "local" as const,
        bucket: "local-downloaded-files",
        key: relativeKey,
        size: fileStat.size,
        lastModified: fileStat.mtimeMs ? Math.round(fileStat.mtimeMs) : null,
        etag: null,
        storageClass: "LOCAL",
        classification: classifyLocalObjectKey(relativeKey),
        deviceId: extractDeviceId(relativeKey),
        url: null,
        localPath: filePath,
      } satisfies PlatformObjectPreview;
    }),
  );

  const prefixes = environment.prefixHints.map((prefix) => {
    const matched = objects.filter((object) => object.key.startsWith(prefix));
    return {
      prefix,
      status: matched.length ? "ready" : "empty",
      objectCount: matched.length,
      sampleKey: matched[0]?.key || null,
      message: matched.length ? null : "本地目录下没有这个前缀的文件。",
    } satisfies BucketPrefixStatus;
  });

  return {
    objects,
    bucketStatuses: [
      {
        bucket: "local-downloaded-files",
        region: "local",
        accessible: true,
        prefixes,
      } satisfies BucketStatus,
    ],
    localRootDir,
  };
}

function getS3Client(region: string) {
  const credentials = hasAwsCredentials()
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!.trim(),
        sessionToken: process.env.AWS_SESSION_TOKEN?.trim(),
      }
    : undefined;

  return new S3Client({
    region,
    credentials,
  });
}

function classifyObjectKey(key: string): PlatformObjectPreview["classification"] {
  if (/shadow/i.test(key)) {
    return "shadow";
  }

  if (/\.json$/i.test(key) && /(ota|firmware|upgrade|job|manifest|tb)/i.test(key)) {
    return "ota-manifest";
  }

  if (/\.(bin|rbl|hex|img)$/i.test(key)) {
    return "ota-binary";
  }

  if (/\.(json|jsonl|ndjson|csv)$/i.test(key) || /(history|telemetry|metric|report|data)/i.test(key)) {
    return "telemetry";
  }

  return "other";
}

function extractDeviceId(value: string) {
  const matches = value.match(DEVICE_ID_REGEX);
  return matches?.[0] || null;
}

function buildPublicUrl(environment: PlatformEnvironment, bucket: string, key: string) {
  if (environment.publicBaseUrl && environment.buckets.length === 1) {
    return `${environment.publicBaseUrl.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  return null;
}

function normalizeObject(object: S3SdkObject, bucket: string, environment: PlatformEnvironment): PlatformObjectPreview {
  const key = object.Key || "";

  return {
    source: "s3",
    bucket,
    key,
    size: object.Size || 0,
    lastModified: object.LastModified?.getTime() || null,
    etag: object.ETag || null,
    storageClass: object.StorageClass || null,
    classification: classifyObjectKey(key),
    deviceId: extractDeviceId(key),
    url: buildPublicUrl(environment, bucket, key),
    localPath: null,
  };
}

async function listBucketObjects(
  client: S3Client,
  environment: PlatformEnvironment,
  bucket: string,
  prefix: string,
  remainingBudget: number,
  stats: QueryStats,
) {
  const maxKeys = Math.max(1, Math.min(remainingBudget, 80));
  const cacheKey = `list:${environment.key}:${bucket}:${prefix}:${maxKeys}`;
  const cached = readCache<PlatformObjectPreview[]>(cacheKey);

  if (cached) {
    stats.cacheHits += 1;
    return cached;
  }

  stats.listRequests += 1;
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      MaxKeys: maxKeys,
    }),
  );
  const objects = (response.Contents || []).map((item) => normalizeObject(item, bucket, environment));
  writeCache(cacheKey, objects);
  return objects;
}

async function listBucketObjectsByPrefix(
  client: S3Client,
  environment: PlatformEnvironment,
  bucket: string,
  prefix: string,
  limit: number | null,
  stats: QueryStats,
) {
  const normalizedLimit = limit === null ? "all" : String(limit);
  const cacheKey = `prefix-list:${environment.key}:${bucket}:${prefix}:${normalizedLimit}`;
  const cached = readCache<PlatformObjectPreview[]>(cacheKey);

  if (cached) {
    stats.cacheHits += 1;
    return cached;
  }

  const objects: PlatformObjectPreview[] = [];
  let continuationToken: string | undefined;

  do {
    stats.listRequests += 1;
    const remaining = limit === null ? 1000 : Math.max(1, Math.min(1000, limit - objects.length));
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        MaxKeys: remaining,
        ContinuationToken: continuationToken,
      }),
    );

    objects.push(...(response.Contents || []).map((item) => normalizeObject(item, bucket, environment)));

    if (limit !== null && objects.length >= limit) {
      break;
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  const sliced = limit === null ? objects : objects.slice(0, limit);
  writeCache(cacheKey, sliced);
  return sliced;
}

async function listCommonPrefixes(
  client: S3Client,
  environment: PlatformEnvironment,
  bucket: string,
  prefix: string,
  limit: number,
  stats: QueryStats,
) {
  const cacheKey = `prefixes:${environment.key}:${bucket}:${prefix}:${limit}`;
  const cached = readCache<string[]>(cacheKey);

  if (cached) {
    stats.cacheHits += 1;
    return cached;
  }

  const prefixes: string[] = [];
  let continuationToken: string | undefined;

  while (prefixes.length < limit) {
    stats.listRequests += 1;

    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        Delimiter: "/",
        ContinuationToken: continuationToken,
        MaxKeys: Math.min(1000, limit),
      }),
    );

    prefixes.push(
      ...(response.CommonPrefixes || [])
        .map((item) => item.Prefix)
        .filter((value): value is string => Boolean(value)),
    );

    if (!response.IsTruncated || !response.NextContinuationToken) {
      break;
    }

    continuationToken = response.NextContinuationToken;
  }

  const uniquePrefixes = [...new Set(prefixes)];
  writeCache(cacheKey, uniquePrefixes);
  return uniquePrefixes;
}

function parseDatePrefixTimestamp(key: string) {
  const match = key.match(/(20\d{2})-(\d{2})-(\d{2})(?:\/|$)/);
  if (!match) {
    return parseTimestampFromKey(key);
  }

  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), 23, 59, 59) - DEVICE_KEY_TIMEZONE_OFFSET_MS;
}

function createDeviceDirectoryPreview(
  environment: PlatformEnvironment,
  bucket: string,
  devicePrefix: string,
  lastModified: number | null,
): PlatformObjectPreview | null {
  const deviceId = extractDeviceId(devicePrefix);
  if (!deviceId) {
    return null;
  }

  return {
    source: "s3",
    bucket,
    key: devicePrefix,
    size: 0,
    lastModified,
    etag: null,
    storageClass: "PREFIX",
    classification: "other",
    deviceId,
    url: buildPublicUrl(environment, bucket, devicePrefix),
    localPath: null,
  };
}

function isDirectoryPreviewObject(object: PlatformObjectPreview) {
  return object.source === "s3" && object.size === 0 && object.key.endsWith("/");
}

async function listIotDataDiscoveryObjects(
  client: S3Client,
  environment: PlatformEnvironment,
  bucket: string,
  prefix: string,
  stats: QueryStats,
) {
  const datePrefixes = await listCommonPrefixes(client, environment, bucket, prefix, COMMON_PREFIX_LIMIT, stats);
  const recentDatePrefixes = [...datePrefixes]
    .sort((left, right) => (parseDatePrefixTimestamp(right) || 0) - (parseDatePrefixTimestamp(left) || 0))
    .slice(0, RECENT_IOT_DATE_LIMIT);

  const objects: PlatformObjectPreview[] = [];

  for (const datePrefix of recentDatePrefixes) {
    const devicePrefixes = await listCommonPrefixes(client, environment, bucket, datePrefix, COMMON_PREFIX_LIMIT, stats);
    const lastModified = parseDatePrefixTimestamp(datePrefix);

    for (const devicePrefix of devicePrefixes) {
      const preview = createDeviceDirectoryPreview(environment, bucket, devicePrefix, lastModified);
      if (preview) {
        objects.push(preview);
      }
    }
  }

  return {
    objects,
    datePrefixes: recentDatePrefixes,
  };
}

async function listSelectedDeviceObjects(
  client: S3Client,
  environment: PlatformEnvironment,
  bucket: string,
  selectedDeviceId: string,
  stats: QueryStats,
  datePrefixLimit = RECENT_IOT_DATE_LIMIT,
  perDayObjectLimit: number | null = SELECTED_DEVICE_OBJECTS_PER_DAY,
) {
  const rootPrefix = environment.prefixHints.find((prefix) => prefix.startsWith("iot-data/")) || "iot-data/";
  const datePrefixes = await listCommonPrefixes(client, environment, bucket, rootPrefix, COMMON_PREFIX_LIMIT, stats);
  const recentDatePrefixes = [...datePrefixes]
    .sort((left, right) => (parseDatePrefixTimestamp(right) || 0) - (parseDatePrefixTimestamp(left) || 0))
    .slice(0, datePrefixLimit);

  const objects: PlatformObjectPreview[] = [];

  for (const datePrefix of recentDatePrefixes) {
    const devicePrefix = `${datePrefix}${selectedDeviceId}/`;
    const deviceObjects =
      perDayObjectLimit === null
        ? await listBucketObjectsByPrefix(client, environment, bucket, devicePrefix, null, stats)
        : await listLatestBucketObjects(client, environment, bucket, devicePrefix, perDayObjectLimit, stats);
    objects.push(...deviceObjects);
  }

  return dedupeObjects(objects).sort((left, right) => (getObjectEventTimestamp(right) || 0) - (getObjectEventTimestamp(left) || 0));
}

async function resolveRepresentativeObjectsForDevices(
  environment: PlatformEnvironment,
  objects: PlatformObjectPreview[],
  stats: QueryStats,
) {
  const devicePrefixes = new Map<string, PlatformObjectPreview>();

  for (const object of objects) {
    if (!object.deviceId) {
      continue;
    }

    const existing = devicePrefixes.get(object.deviceId);
    if (!existing || (object.lastModified || 0) > (existing.lastModified || 0)) {
      devicePrefixes.set(object.deviceId, object);
    }
  }

  if (!devicePrefixes.size) {
    return [] as PlatformObjectPreview[];
  }

  if (!hasAwsCredentials() || !environment.buckets.length) {
    return [...devicePrefixes.values()].filter((object) => !isDirectoryPreviewObject(object));
  }

  const client = getS3Client(environment.region);
  const resolved: PlatformObjectPreview[] = [];

  for (const object of devicePrefixes.values()) {
    if (!isDirectoryPreviewObject(object)) {
      resolved.push(object);
      continue;
    }

    try {
      const listed = await listLatestBucketObjects(client, environment, object.bucket, object.key, 1, stats);
      if (listed[0]) {
        resolved.push(listed[0]);
      }
    } catch {
      continue;
    }
  }

  return resolved;
}

async function collectDeviceMetricCounts(
  environment: PlatformEnvironment,
  objects: PlatformObjectPreview[],
  stats: QueryStats,
) {
  const cacheSignature = objects
    .filter((object) => Boolean(object.deviceId))
    .map((object) => `${object.deviceId}:${getObjectEventTimestamp(object) || 0}`)
    .sort()
    .join("|");
  const cacheKey = `device-metric-counts:${environment.key}:${cacheSignature}`;
  const cached = readCache<Record<string, { metricCount: number; lastReportedAt: number | null; productKey: string | null }>>(cacheKey);

  if (cached) {
    stats.cacheHits += 1;
    return new Map(Object.entries(cached)) as DeviceLiveSnapshotMap;
  }

  const representativeObjects = await resolveRepresentativeObjectsForDevices(environment, objects, stats);
  if (!representativeObjects.length) {
    return new Map<string, { metricCount: number; lastReportedAt: number | null; productKey: string | null }>() as DeviceLiveSnapshotMap;
  }

  const counts = new Map<string, Set<string>>();
  const timestamps = new Map<string, number | null>();
  const productKeys = new Map<string, string | null>();
  const client = hasAwsCredentials() && environment.buckets.length ? getS3Client(environment.region) : null;

  await forEachWithConcurrency(representativeObjects, METRIC_COUNT_CONCURRENCY, async (object) => {
    const deviceId = object.deviceId;
    if (!deviceId) {
      return;
    }

    try {
      const textPayload = isLocalObject(object)
        ? await fetchLocalObjectText(object, stats)
        : client
          ? await fetchObjectText(client, object, stats)
          : null;

      if (!textPayload) {
        return;
      }

      const parsed = parseJsonLike(textPayload.text);
      const fallbackTimestamp = getObjectEventTimestamp(object) || Date.now();
      const payloadUnits = extractPayloadUnits(parsed);
      const sourceKey =
        deviceId && !extractDeviceId(object.key) ? `${object.key}#${deviceId}` : object.key;
      const identifierSet = counts.get(deviceId) || new Set<string>();

      for (const payloadUnit of payloadUnits) {
        const payloadSamples: MetricSample[] = [];
        collectMetricSamples(payloadUnit.payload, sourceKey, fallbackTimestamp, payloadSamples);

        for (const sample of payloadSamples) {
          identifierSet.add(sample.identifier);
          const latestTimestamp = timestamps.get(deviceId);
          if (!latestTimestamp || sample.timestamp > latestTimestamp) {
            timestamps.set(deviceId, sample.timestamp);
          }

          if (!productKeys.get(deviceId) && isDeviceProductKeyIdentifier(sample.identifier)) {
            const normalizedProductKey = normalizeDeviceProductKey(sample.value);
            if (normalizedProductKey) {
              productKeys.set(deviceId, normalizedProductKey);
            }
          }
        }
      }

      counts.set(deviceId, identifierSet);
    } catch {
      return;
    }
  });

  const result = new Map(
    [...counts.entries()].map(([deviceId, identifiers]) => [
      deviceId,
      {
        metricCount: identifiers.size,
        lastReportedAt: timestamps.get(deviceId) || null,
        productKey: productKeys.get(deviceId) || null,
      },
    ]),
  ) as DeviceLiveSnapshotMap;
  writeCache(cacheKey, Object.fromEntries(result), 5 * 60_000);
  return result;
}

async function listS3RelevantObjects(environment: PlatformEnvironment, stats: QueryStats) {
  if (!environment.buckets.length || !hasAwsCredentials()) {
    return {
      objects: [] as PlatformObjectPreview[],
      bucketStatuses: environment.buckets.map((bucket) => ({
        bucket,
        region: environment.region,
        accessible: false,
        prefixes: environment.prefixHints.map((prefix) => ({
          prefix,
          status: "skipped" as const,
          objectCount: 0,
          sampleKey: null,
          message: hasAwsCredentials() ? "No prefix probe was attempted." : "AWS credentials are not configured.",
        })),
      })),
    };
  }

  const client = getS3Client(environment.region);
  const results: PlatformObjectPreview[] = [];
  const bucketStatuses: BucketStatus[] = [];
  let remainingBudget = LIST_BUDGET;

  for (const bucket of environment.buckets) {
    const prefixes: BucketPrefixStatus[] = [];
    let accessDeniedMessage: string | null = null;

    for (const prefix of environment.prefixHints) {
      if (remainingBudget <= 0) {
        prefixes.push({
          prefix,
          status: "skipped",
          objectCount: 0,
          sampleKey: null,
          message: "List budget exhausted before this prefix could be sampled.",
        });
        break;
      }

      if (accessDeniedMessage) {
        prefixes.push({
          prefix,
          status: "skipped",
          objectCount: 0,
          sampleKey: null,
          message: accessDeniedMessage,
        });
        continue;
      }

      try {
        const objects =
          prefix === "iot-data/"
            ? (await listIotDataDiscoveryObjects(client, environment, bucket, prefix, stats)).objects
            : await listBucketObjects(client, environment, bucket, prefix, remainingBudget, stats);
        results.push(...objects);
        remainingBudget -= Math.min(objects.length || 1, 80);
        prefixes.push({
          prefix,
          status: objects.length ? "ready" : "empty",
          objectCount: objects.length,
          sampleKey: objects[0]?.key || null,
          message: objects.length ? null : "Prefix is reachable but returned no sampled objects.",
        });
      } catch (error) {
        const message = describeS3Error(error);
        const denied = isAccessDeniedError(error);
        remainingBudget -= 1;
        prefixes.push({
          prefix,
          status: denied ? "denied" : "error",
          objectCount: 0,
          sampleKey: null,
          message,
        });
        if (denied) {
          accessDeniedMessage = message;
        }
      }
    }

    bucketStatuses.push({
      bucket,
      region: environment.region,
      accessible: prefixes.some((prefix) => prefix.status === "ready" || prefix.status === "empty"),
      prefixes,
    });
  }

  return {
    objects: dedupeObjects(results).sort((left, right) => {
      return (getObjectEventTimestamp(right) || 0) - (getObjectEventTimestamp(left) || 0);
    }),
    bucketStatuses,
  };
}

async function listRelevantObjects(environment: PlatformEnvironment, stats: QueryStats) {
  const [localListing, s3Listing] = await Promise.all([
    listLocalObjects(environment),
    listS3RelevantObjects(environment, stats),
  ]);

  const useS3Objects = s3Listing.objects.length > 0;
  const useLocalFallback = !useS3Objects && localListing.objects.length > 0;
  const preferredObjects = useS3Objects ? s3Listing.objects : useLocalFallback ? localListing.objects : [];
  const objects = dedupeObjects(preferredObjects).sort((left, right) => {
    return (getObjectEventTimestamp(right) || 0) - (getObjectEventTimestamp(left) || 0);
  });

  stats.objectsDiscovered = objects.length;

  return {
    objects,
    bucketStatuses: [...localListing.bucketStatuses, ...s3Listing.bucketStatuses],
    localRootDir: localListing.localRootDir,
    dataSourceMode: useS3Objects ? ("s3" as const) : useLocalFallback ? ("local" as const) : ("none" as const),
  };
}

function dedupeObjects(objects: PlatformObjectPreview[]) {
  const seen = new Map<string, PlatformObjectPreview>();

  for (const object of objects) {
    seen.set(`${object.bucket}:${object.key}`, object);
  }

  return [...seen.values()];
}

function isIotDataObject(object: PlatformObjectPreview) {
  return object.key.startsWith("iot-data/");
}

function isIotDataErrorObject(object: PlatformObjectPreview) {
  return object.key.startsWith("iot-data-error/");
}

function isLocalObject(object: PlatformObjectPreview) {
  return object.source === "local";
}

function collectDeviceSummaries(
  objects: PlatformObjectPreview[],
  samples: MetricSample[],
  deviceMetricCounts?: DeviceLiveSnapshotMap,
) {
  const sampleCounts = new Map<string, Set<string>>();
  const sampleProductKeys = new Map<string, string | null>();
  for (const sample of samples) {
    const sourceDeviceId = extractDeviceId(sample.sourceKey);
    if (!sourceDeviceId) {
      continue;
    }

    const bucket = sampleCounts.get(sourceDeviceId) || new Set<string>();
    bucket.add(sample.identifier);
    sampleCounts.set(sourceDeviceId, bucket);

    if (!sampleProductKeys.get(sourceDeviceId) && isDeviceProductKeyIdentifier(sample.identifier)) {
      const normalizedProductKey = normalizeDeviceProductKey(sample.value);
      if (normalizedProductKey) {
        sampleProductKeys.set(sourceDeviceId, normalizedProductKey);
      }
    }
  }

  const grouped = new Map<string, DeviceSummary>();

  const sourceObjects = objects.some((object) => isIotDataObject(object))
    ? objects.filter((object) => isIotDataObject(object))
    : objects;

  for (const object of sourceObjects) {
    if (!object.deviceId) {
      continue;
    }

    const entry = grouped.get(object.deviceId) || {
      id: object.deviceId,
      label: object.deviceId,
      productKey: deviceMetricCounts?.get(object.deviceId)?.productKey ?? sampleProductKeys.get(object.deviceId) ?? null,
      modelLabel: getDeviceModelLabel(deviceMetricCounts?.get(object.deviceId)?.productKey ?? sampleProductKeys.get(object.deviceId) ?? null),
      objectCount: 0,
      otaCount: 0,
      metricCount: deviceMetricCounts?.get(object.deviceId)?.metricCount ?? sampleCounts.get(object.deviceId)?.size ?? 0,
      lastSeen: null,
      sampleKeys: [],
    };

    entry.objectCount += 1;
    if (object.classification === "ota-manifest" || object.classification === "ota-binary") {
      entry.otaCount += 1;
    }

    const objectTimestamp = deviceMetricCounts?.get(object.deviceId)?.lastReportedAt || getObjectEventTimestamp(object);
    if (!entry.lastSeen || (objectTimestamp || 0) > entry.lastSeen) {
      entry.lastSeen = objectTimestamp;
    }

    if (entry.sampleKeys.length < 3) {
      entry.sampleKeys.push(object.key);
    }

    grouped.set(object.deviceId, entry);
  }

  if (deviceMetricCounts) {
    for (const [deviceId, snapshot] of deviceMetricCounts.entries()) {
      const existing = grouped.get(deviceId);
      if (existing) {
        existing.metricCount = Math.max(existing.metricCount, snapshot.metricCount);
        existing.productKey = snapshot.productKey || existing.productKey || sampleProductKeys.get(deviceId) || null;
        existing.modelLabel = getDeviceModelLabel(existing.productKey);
        existing.lastSeen = snapshot.lastReportedAt || existing.lastSeen;
      }
    }
  }

  if (!grouped.size) {
    grouped.set(sampleManifest.deviceId, {
      id: sampleManifest.deviceId,
      label: `${sampleManifest.deviceId} (sample OTA)`,
      productKey: null,
      modelLabel: "未知",
      objectCount: 1,
      otaCount: sampleManifest.modules.length,
      metricCount: 0,
      lastSeen: null,
      sampleKeys: [sampleManifest.key],
    });
  }

  return [...grouped.values()].sort((left, right) => {
    return (right.lastSeen || 0) - (left.lastSeen || 0) || right.objectCount - left.objectCount;
  });
}

function parseTimestampLike(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) {
      return Math.round(value);
    }

    if (value > 1_000_000_000) {
      return Math.round(value * 1000);
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{13}$/.test(trimmed)) {
      return Number(trimmed);
    }

    if (/^\d{10}$/.test(trimmed)) {
      return Number(trimmed) * 1000;
    }

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parseTimestampFromKey(key: string) {
  const compact = key.match(/(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - DEVICE_KEY_TIMEZONE_OFFSET_MS;
  }

  const dashed = key.match(/(20\d{2})-(\d{2})-(\d{2})[-T_](\d{2})[:.-](\d{2})[:.-](\d{2})/);
  if (dashed) {
    const [, year, month, day, hour, minute, second] = dashed;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - DEVICE_KEY_TIMEZONE_OFFSET_MS;
  }

  return null;
}

function getObjectEventTimestamp(object: PlatformObjectPreview) {
  return parseTimestampFromKey(object.key) || object.lastModified;
}

function normalizeDeviceProductKey(value: MetricSample["value"]) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value === 1 || value === 2 ? String(value) : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return parsed === 1 || parsed === 2 ? String(parsed) : null;
  }

  return null;
}

function isDeviceProductKeyIdentifier(identifier: string) {
  const field = findFieldByIdentifier(identifier);
  return field?.identifier === "PowerKind" || normalizeMetricKey(identifier) === "pk";
}

function getDeviceModelLabel(productKey: string | null) {
  if (productKey === "1") {
    return "500";
  }

  if (productKey === "2") {
    return "500PRO";
  }

  return "未知";
}

function getSelectedDeviceDateLimit(
  hours: number,
  startTimestamp: number | null,
  endTimestamp: number | null,
  maxDateLimit: number,
) {
  if (startTimestamp !== null || endTimestamp !== null) {
    if (startTimestamp !== null && endTimestamp !== null && endTimestamp > startTimestamp) {
      return Math.min(maxDateLimit, Math.max(2, Math.ceil((endTimestamp - startTimestamp) / DAY_IN_MS) + 2));
    }

    return maxDateLimit;
  }

  if (hours === 0) {
    return maxDateLimit;
  }

  return Math.min(maxDateLimit, Math.max(2, Math.ceil(hours / 24) + 1));
}

function getHistoryObjectFetchLimit(dateLimit: number) {
  return Math.min(HISTORY_FETCH_MAX_BUDGET, Math.max(HISTORY_FETCH_BUDGET, dateLimit * HISTORY_FETCH_OBJECTS_PER_DAY));
}

function getObjectLocalDayKey(object: PlatformObjectPreview) {
  const prefixMatch = object.key.match(/(20\d{2}-\d{2}-\d{2})(?:\/|$)/);
  if (prefixMatch) {
    return prefixMatch[1];
  }

  const timestamp = getObjectEventTimestamp(object);
  if (timestamp === null) {
    return object.key;
  }

  return new Date(timestamp + DEVICE_KEY_TIMEZONE_OFFSET_MS).toISOString().slice(0, 10);
}

function selectObjectsForParsing(
  objects: PlatformObjectPreview[],
  maxObjectsToFetch: number,
  strategy: "latest" | "balanced-by-day",
) {
  if (objects.length <= maxObjectsToFetch || strategy === "latest") {
    return objects.slice(0, maxObjectsToFetch);
  }

  const buckets = new Map<string, PlatformObjectPreview[]>();

  for (const object of objects) {
    const dayKey = getObjectLocalDayKey(object);
    const bucket = buckets.get(dayKey);

    if (bucket) {
      bucket.push(object);
    } else {
      buckets.set(dayKey, [object]);
    }
  }

  const orderedDayKeys = [...buckets.keys()].sort((left, right) => {
    const leftBucket = buckets.get(left);
    const rightBucket = buckets.get(right);
    const leftTimestamp = leftBucket?.[0] ? getObjectEventTimestamp(leftBucket[0]) || 0 : 0;
    const rightTimestamp = rightBucket?.[0] ? getObjectEventTimestamp(rightBucket[0]) || 0 : 0;
    return rightTimestamp - leftTimestamp;
  });

  const selected: PlatformObjectPreview[] = [];

  while (selected.length < maxObjectsToFetch) {
    let addedInRound = false;

    for (const dayKey of orderedDayKeys) {
      const bucket = buckets.get(dayKey);
      const nextObject = bucket?.shift();
      if (!nextObject) {
        continue;
      }

      selected.push(nextObject);
      addedInRound = true;

      if (selected.length >= maxObjectsToFetch) {
        break;
      }
    }

    if (!addedInRound) {
      break;
    }
  }

  return selected.sort((left, right) => (getObjectEventTimestamp(right) || 0) - (getObjectEventTimestamp(left) || 0));
}

async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
}

async function listLatestBucketObjects(
  client: S3Client,
  environment: PlatformEnvironment,
  bucket: string,
  prefix: string,
  limit: number,
  stats: QueryStats,
) {
  const objects = (await listBucketObjectsByPrefix(client, environment, bucket, prefix, null, stats))
    .sort((left, right) => (getObjectEventTimestamp(right) || 0) - (getObjectEventTimestamp(left) || 0))
    .slice(0, limit);
  return objects;
}

function coerceScalar(value: unknown) {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }

    return trimmed;
  }

  return undefined;
}

function parseJsonLike(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const chunks = splitConcatenatedJson(trimmed);
    if (chunks.length > 1) {
      return chunks
        .map((chunk) => {
          try {
            return JSON.parse(chunk);
          } catch {
            return null;
          }
        })
        .filter((item) => item !== null);
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      return null;
    }

    if (lines.every((line) => line.startsWith("{") || line.startsWith("["))) {
      return lines.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return line;
        }
      });
    }

    return lines;
  }
}

function resolveFieldSample(
  field: ObjectModelField,
  rawValue: unknown,
  timestamp: number,
  sourceKey: string,
  resolvedIdentifier = field.identifier,
  resolvedLabel = field.name,
  resolvedShortCode = field.shortCode || field.identifier,
): MetricSample | null {
  const value = coerceScalar(rawValue);
  if (value === undefined) {
    return null;
  }

  return {
    identifier: resolvedIdentifier,
    canonicalIdentifier: field.identifier,
    label: resolvedLabel,
    shortCode: resolvedShortCode,
    timestamp,
    value,
    sourceKey,
  };
}

function splitConcatenatedJson(text: string) {
  const chunks: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (start === -1) {
      if (/\s/.test(character)) {
        continue;
      }

      if (character === "{" || character === "[") {
        start = index;
        depth = 1;
      }

      continue;
    }

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (character === "\\") {
        escaping = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{" || character === "[") {
      depth += 1;
      continue;
    }

    if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) {
        chunks.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return chunks;
}

function decodeBase64JsonText(value: string) {
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function extractPayloadUnits(input: unknown): ExtractedPayload[] {
  if (Array.isArray(input)) {
    return input.flatMap((item) => extractPayloadUnits(item));
  }

  if (!input || typeof input !== "object") {
    return [];
  }

  const units: ExtractedPayload[] = [
    {
      payload: input,
      source: "json-body",
    },
  ];
  const record = input as Record<string, unknown>;
  const rawData = typeof record.rawData === "string" ? decodeBase64JsonText(record.rawData) : null;

  if (rawData) {
    const parsedRawData = parseJsonLike(rawData);
    if (parsedRawData) {
      const decodedUnits = extractPayloadUnits(parsedRawData).map((unit) => ({
        ...unit,
        source: "base64-raw-data" as const,
      }));
      units.unshift(...decodedUnits);
    }
  }

  return units;
}

function collectMetricSamples(
  input: unknown,
  sourceKey: string,
  fallbackTimestamp: number,
  samples: MetricSample[],
  depth = 0,
) {
  if (depth > 5 || samples.length > 5000) {
    return;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      collectMetricSamples(item, sourceKey, fallbackTimestamp, samples, depth + 1);
    }
    return;
  }

  if (!input || typeof input !== "object") {
    return;
  }

  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  const recordTimestamp =
    TIMESTAMP_KEYS.map((key) => record[key]).map(parseTimestampLike).find(Boolean) ||
    fallbackTimestamp ||
    Date.now();

  const dateKeyEntries = keys
    .map((key) => ({ key, timestamp: parseTimestampLike(key) }))
    .filter((entry) => entry.timestamp !== null);

  if (dateKeyEntries.length >= 3) {
    for (const entry of dateKeyEntries) {
      collectMetricSamples(record[entry.key], sourceKey, entry.timestamp || fallbackTimestamp, samples, depth + 1);
    }
    return;
  }

  let matchedDirectField = false;

  for (const [key, value] of Object.entries(record)) {
    const resolvedField = resolveMetricField(key);
    if (!resolvedField) {
      continue;
    }

    const sample = resolveFieldSample(
      resolvedField.field,
      value,
      recordTimestamp,
      sourceKey,
      resolvedField.identifier,
      resolvedField.label,
      resolvedField.shortCode,
    );
    if (sample) {
      samples.push(sample);
      matchedDirectField = true;
    }
  }

  if (matchedDirectField && depth > 0) {
    return;
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value) || (value && typeof value === "object")) {
      collectMetricSamples(value, sourceKey, recordTimestamp, samples, depth + 1);
    }
  }
}

function formatMetricValue(field: ObjectModelField, rawValue: string | number | boolean | null) {
  if (rawValue === null) {
    return "--";
  }

  if (typeof rawValue === "boolean") {
    return rawValue ? "true" : "false";
  }

  if (field.dataType === "ENUM" && typeof rawValue === "number" && field.enumOptions.length) {
    const match = field.enumOptions.find((option) => option.value === String(rawValue));
    return match ? `${match.label} (${rawValue})` : String(rawValue);
  }

  if (typeof rawValue === "number") {
    return formatScaledFieldNumericValue(field, scaleFieldNumericValue(field, rawValue));
  }

  return String(rawValue);
}

function buildCurrentValues(samples: MetricSample[]) {
  const latest = new Map<string, MetricSample>();

  for (const sample of samples) {
    const current = latest.get(sample.identifier);
    if (!current || sample.timestamp >= current.timestamp) {
      latest.set(sample.identifier, sample);
    }
  }

  return [...latest.values()]
    .map<CurrentMetricValue | null>((sample) => {
      const field = findFieldByIdentifier(sample.identifier);
      if (!field) {
        return null;
      }

      return {
        identifier: sample.identifier,
        canonicalIdentifier: sample.canonicalIdentifier,
        label: sample.label,
        shortCode: sample.shortCode,
        module: field.module,
        access: field.access,
        dataType: field.dataType,
        unit: getFieldDisplayUnit(field),
        rawValue: sample.value,
        value: formatMetricValue(field, sample.value),
        timestamp: sample.timestamp,
        sourceKey: sample.sourceKey,
      };
    })
    .filter((item): item is CurrentMetricValue => item !== null)
    .sort((left, right) => left.module.localeCompare(right.module) || left.identifier.localeCompare(right.identifier));
}

function dedupeHistorySeries(series: MetricHistoryPoint[]) {
  const byTimestamp = new Map<number, MetricHistoryPoint>();

  for (const point of series) {
    byTimestamp.set(point.timestamp, point);
  }

  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function compressSeries(series: MetricHistoryPoint[]) {
  const normalizedSeries = dedupeHistorySeries(series);

  if (normalizedSeries.length <= MAX_HISTORY_POINTS) {
    return normalizedSeries;
  }

  const first = normalizedSeries[0];
  const last = normalizedSeries[normalizedSeries.length - 1];
  const interiorPoints = normalizedSeries.slice(1, -1);
  const maxInteriorPoints = Math.max(0, MAX_HISTORY_POINTS - 2);

  if (!interiorPoints.length || maxInteriorPoints === 0) {
    return first.timestamp === last.timestamp && first.value === last.value ? [first] : [first, last];
  }

  const bucketCount = Math.max(1, Math.ceil(maxInteriorPoints / 2));
  const bucketSize = Math.ceil(interiorPoints.length / bucketCount);
  const compressed: MetricHistoryPoint[] = [first];

  for (let index = 0; index < interiorPoints.length; index += bucketSize) {
    const bucket = interiorPoints.slice(index, index + bucketSize);
    if (!bucket.length) {
      continue;
    }

    let minPoint = bucket[0];
    let maxPoint = bucket[0];

    for (const point of bucket) {
      if (point.value < minPoint.value) {
        minPoint = point;
      }

      if (point.value > maxPoint.value) {
        maxPoint = point;
      }
    }

    const bucketPoints = [minPoint, maxPoint].sort((left, right) => left.timestamp - right.timestamp);

    for (const point of bucketPoints) {
      const previous = compressed[compressed.length - 1];
      if (!previous || previous.timestamp !== point.timestamp) {
        compressed.push(point);
      }
    }
  }

  const previous = compressed[compressed.length - 1];
  if (!previous || previous.timestamp !== last.timestamp) {
    compressed.push(last);
  }

  return compressed;
}

function buildMetricOptions(samples: MetricSample[]) {
  const latestNumericSamples = new Map<string, MetricSample>();

  for (const sample of samples) {
    if (typeof sample.value !== "number") {
      continue;
    }

    const current = latestNumericSamples.get(sample.identifier);
    if (!current || sample.timestamp >= current.timestamp) {
      latestNumericSamples.set(sample.identifier, sample);
    }
  }

  const preferred = getPreferredMetricIdentifiers().filter((identifier) => latestNumericSamples.has(identifier));
  const preferredSet = new Set(preferred);
  const remaining = [...latestNumericSamples.values()]
    .filter((sample) => !preferredSet.has(sample.identifier))
    .sort((left, right) => left.identifier.localeCompare(right.identifier));

  const orderedSamples = [
    ...preferred.map((identifier) => latestNumericSamples.get(identifier)).filter((sample): sample is MetricSample => sample !== undefined),
    ...remaining,
  ];

  return orderedSamples.map((sample) => ({
    identifier: sample.identifier,
    label: sample.identifier === sample.canonicalIdentifier ? getFieldDisplayName(sample.identifier) : `${sample.label} (${sample.identifier})`,
  }));
}

function filterSamplesByRange(samples: MetricSample[], startTimestamp: number | null, endTimestamp: number | null) {
  if (startTimestamp === null && endTimestamp === null) {
    return samples;
  }

  return samples.filter((sample) => {
    if (startTimestamp !== null && sample.timestamp < startTimestamp) {
      return false;
    }

    if (endTimestamp !== null && sample.timestamp > endTimestamp) {
      return false;
    }

    return true;
  });
}

function filterPayloadPreviewsByRange(payloadPreviews: PayloadPreview[], startTimestamp: number | null, endTimestamp: number | null) {
  if (startTimestamp === null && endTimestamp === null) {
    return payloadPreviews;
  }

  return payloadPreviews.filter((preview) => {
    if (preview.timestamp === null) {
      return startTimestamp === null && endTimestamp === null;
    }

    if (startTimestamp !== null && preview.timestamp < startTimestamp) {
      return false;
    }

    if (endTimestamp !== null && preview.timestamp > endTimestamp) {
      return false;
    }

    return true;
  });
}

function filterObjectsByRange(objects: PlatformObjectPreview[], startTimestamp: number | null, endTimestamp: number | null) {
  if (startTimestamp === null && endTimestamp === null) {
    return objects;
  }

  return objects.filter((object) => {
    const timestamp = getObjectEventTimestamp(object);
    if (timestamp === null) {
      return false;
    }

    if (startTimestamp !== null && timestamp < startTimestamp) {
      return false;
    }

    if (endTimestamp !== null && timestamp > endTimestamp) {
      return false;
    }

    return true;
  });
}

function filterCurrentValuesBySearch(currentValues: CurrentMetricValue[], fieldSearch: string) {
  if (!fieldSearch) {
    return currentValues;
  }

  return currentValues.filter((value) => {
    return (
      matchesSearch(value.identifier, fieldSearch) ||
      matchesSearch(value.canonicalIdentifier, fieldSearch) ||
      matchesSearch(value.shortCode, fieldSearch) ||
      matchesSearch(value.label, fieldSearch) ||
      matchesSearch(value.module, fieldSearch) ||
      matchesSearch(value.value, fieldSearch)
    );
  });
}

function filterMetricOptionsBySearch(metricOptions: Array<{ identifier: string; label: string }>, fieldSearch: string) {
  if (!fieldSearch) {
    return metricOptions;
  }

  return metricOptions.filter((metric) => matchesSearch(metric.identifier, fieldSearch) || matchesSearch(metric.label, fieldSearch));
}

function filterDeviceOptionsBySearch(deviceOptions: DeviceSummary[], deviceSearch: string, selectedDeviceId: string | null) {
  if (!deviceSearch) {
    return deviceOptions;
  }

  const filtered = deviceOptions.filter((device) => {
    return (
      matchesSearch(device.id, deviceSearch) ||
      matchesSearch(device.label, deviceSearch) ||
      device.sampleKeys.some((sampleKey) => matchesSearch(sampleKey, deviceSearch))
    );
  });

  if (selectedDeviceId && !filtered.some((device) => device.id === selectedDeviceId)) {
    const selectedDevice = deviceOptions.find((device) => device.id === selectedDeviceId);
    if (selectedDevice) {
      return [selectedDevice, ...filtered];
    }
  }

  return filtered;
}

function filterDeviceOptionsByType(deviceOptions: DeviceSummary[], deviceType: "all" | "500" | "500PRO") {
  if (deviceType === "all") {
    return deviceOptions;
  }

  return deviceOptions.filter((device) => device.modelLabel === deviceType);
}

function selectMetricHistorySeries(
  samples: MetricSample[],
  metricId: string | null,
  hours: number,
  startTimestamp: number | null,
  endTimestamp: number | null,
) {
  if (!metricId) {
    return [] as MetricHistoryPoint[];
  }

  const metricSamples = samples
    .filter((sample) => sample.identifier === metricId && typeof sample.value === "number")
    .map((sample) => {
      const field = findFieldByIdentifier(sample.identifier);
      return {
        timestamp: sample.timestamp,
        value: field ? scaleFieldNumericValue(field, sample.value as number) : (sample.value as number),
      };
    })
    .sort((left, right) => left.timestamp - right.timestamp);

  if (!metricSamples.length) {
    return [] as MetricHistoryPoint[];
  }

  const explicitRangeApplied = startTimestamp !== null || endTimestamp !== null;
  const filteredSamples = explicitRangeApplied
    ? metricSamples.filter((sample) => {
        if (startTimestamp !== null && sample.timestamp < startTimestamp) {
          return false;
        }

        if (endTimestamp !== null && sample.timestamp > endTimestamp) {
          return false;
        }

        return true;
      })
    : (() => {
        if (hours === 0) {
          return metricSamples;
        }

        const latestAvailableTimestamp = metricSamples[metricSamples.length - 1]?.timestamp || Date.now();
        const anchorTimestamp = latestAvailableTimestamp < Date.now() ? latestAvailableTimestamp : Date.now();
        const cutoff = anchorTimestamp - hours * 60 * 60 * 1000;
        return metricSamples.filter((sample) => sample.timestamp >= cutoff);
      })();

  return dedupeHistorySeries(filteredSamples);
}

function buildHistorySeries(
  samples: MetricSample[],
  metricId: string | null,
  hours: number,
  startTimestamp: number | null,
  endTimestamp: number | null,
) {
  return compressSeries(selectMetricHistorySeries(samples, metricId, hours, startTimestamp, endTimestamp));
}

function formatValueByIdentifier(identifier: string, value: number | null) {
  if (value === null) {
    return "--";
  }

  const field = findFieldByIdentifier(identifier);
  if (!field) {
    return String(value);
  }

  return formatMetricValue(field, value);
}

const BYTE_REVERSED_FAULT_IDENTIFIERS = new Set(["DF1", "DF2", "AF1", "AF2"]);
const FAULT_SEVERITY_PRIORITY = new Map([
  ["故障", 0],
  ["告警", 1],
  ["提示", 2],
]);
const faultDefinitionsByAlias = buildFaultDefinitionAliasMap();

function normalizeNumericRawValue(value: CurrentMetricValue["rawValue"]) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Math.trunc(Number(value));
  }

  return null;
}

function toFaultBigInt(value: number) {
  return BigInt.asUintN(32, BigInt(Math.trunc(value)));
}

function formatHexValue(value: bigint, minDigits: number) {
  const hex = value.toString(16).toUpperCase();
  return `0x${hex.padStart(minDigits, "0")}`;
}

function getFaultMask(identifier: string, identifierBit: number) {
  const upperIdentifier = identifier.toUpperCase();

  if (BYTE_REVERSED_FAULT_IDENTIFIERS.has(upperIdentifier)) {
    const byteIndex = Math.floor((identifierBit - 1) / 8);
    const bitInByte = (identifierBit - 1) % 8;
    return 1n << BigInt((3 - byteIndex) * 8 + bitInByte);
  }

  return 1n << BigInt(identifierBit - 1);
}

function buildFaultDefinitionAliasMap() {
  const map = new Map<string, FaultDefinition[]>();

  for (const definition of faultDefinitions) {
    if (!definition.identifier) {
      continue;
    }

    const aliases = new Set([normalizeMetricKey(definition.identifier)]);
    for (const field of findFieldsByIdentifier(definition.identifier)) {
      aliases.add(normalizeMetricKey(field.identifier));
      if (field.shortCode) {
        aliases.add(normalizeMetricKey(field.shortCode));
      }
    }

    for (const alias of aliases) {
      map.set(alias, [...(map.get(alias) || []), definition]);
    }
  }

  return map;
}

function getFaultDefinitionsForIdentifier(identifier: string) {
  return faultDefinitionsByAlias.get(normalizeMetricKey(identifier)) || [];
}

function decodeFaultEntriesFromSource(source: {
  identifier: string;
  label: string;
  dataType: string;
  numericValue: number;
}) {
  const definitions = getFaultDefinitionsForIdentifier(source.identifier);
  if (!definitions.length) {
    return [] as DecodedFaultEntry[];
  }

  const rawValue = toFaultBigInt(source.numericValue);
  const rawHexDigits = source.dataType === "UINT8" || source.dataType === "FAULT8" ? 2 : 8;

  return definitions.flatMap<DecodedFaultEntry>((definition) => {
    if (!definition.identifier || definition.identifierBit === null) {
      return [];
    }

    const mask = getFaultMask(definition.identifier, definition.identifierBit);
    if ((rawValue & mask) === 0n) {
      return [];
    }

    return [
      {
        group: definition.group,
        groupBit: definition.groupBit,
        identifier: definition.identifier,
        identifierBit: definition.identifierBit,
        sourceIdentifier: source.identifier,
        sourceLabel: source.label,
        severity: definition.severity,
        code: definition.code,
        category: definition.category,
        display: definition.display,
        name: definition.name || definition.meaning,
        meaning: definition.meaning,
        description: definition.description,
        nameEn: definition.nameEn,
        rawValue: source.numericValue,
        rawHex: formatHexValue(rawValue, rawHexDigits),
        maskHex: formatHexValue(mask, 8),
      },
    ];
  });
}

function sortDecodedFaults<T extends Pick<DecodedFaultEntry, "severity" | "groupBit" | "identifierBit"> & { timestamp?: number }>(entries: T[]) {
  return [...entries].sort((left, right) => {
    if (typeof left.timestamp === "number" && typeof right.timestamp === "number" && right.timestamp !== left.timestamp) {
      return right.timestamp - left.timestamp;
    }

    const severityDelta = (FAULT_SEVERITY_PRIORITY.get(left.severity) ?? 9) - (FAULT_SEVERITY_PRIORITY.get(right.severity) ?? 9);
    if (severityDelta !== 0) {
      return severityDelta;
    }

    const groupDelta = (left.groupBit ?? 999) - (right.groupBit ?? 999);
    if (groupDelta !== 0) {
      return groupDelta;
    }

    return (left.identifierBit ?? 999) - (right.identifierBit ?? 999);
  });
}

function dedupeDecodedFaults<T extends DecodedFaultEntry>(entries: T[]) {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const entry of entries) {
    const key = [
      entry.sourceIdentifier,
      entry.identifier,
      entry.identifierBit,
      entry.code,
      entry.rawHex,
    ].join(":");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function decodeActiveFaults(currentValues: CurrentMetricValue[]) {
  if (!faultDefinitions.length) {
    return [] as DecodedFaultEntry[];
  }

  const decoded = currentValues.flatMap((entry) => {
    const numericValue = normalizeNumericRawValue(entry.rawValue);
    if (numericValue === null) {
      return [];
    }

    return decodeFaultEntriesFromSource({
      identifier: entry.identifier,
      label: entry.label,
      dataType: entry.dataType,
      numericValue,
    });
  });

  return sortDecodedFaults(dedupeDecodedFaults(decoded));
}

function selectFaultHistorySamples(
  samples: MetricSample[],
  hours: number,
  startTimestamp: number | null,
  endTimestamp: number | null,
) {
  const faultSamples = samples
    .filter((sample) => typeof sample.value === "number" && getFaultDefinitionsForIdentifier(sample.identifier).length > 0)
    .sort((left, right) => left.timestamp - right.timestamp);

  if (!faultSamples.length) {
    return [] as MetricSample[];
  }

  const explicitRangeApplied = startTimestamp !== null || endTimestamp !== null;
  return explicitRangeApplied
    ? faultSamples.filter((sample) => {
        if (startTimestamp !== null && sample.timestamp < startTimestamp) {
          return false;
        }

        if (endTimestamp !== null && sample.timestamp > endTimestamp) {
          return false;
        }

        return true;
      })
    : (() => {
        if (hours === 0) {
          return faultSamples;
        }

        const latestAvailableTimestamp = faultSamples[faultSamples.length - 1]?.timestamp || Date.now();
        const anchorTimestamp = latestAvailableTimestamp < Date.now() ? latestAvailableTimestamp : Date.now();
        const cutoff = anchorTimestamp - hours * 60 * 60 * 1000;
        return faultSamples.filter((sample) => sample.timestamp >= cutoff);
      })();
}

function buildFaultHistoryEntries(
  samples: MetricSample[],
  hours: number,
  startTimestamp: number | null,
  endTimestamp: number | null,
) {
  const selectedSamples = selectFaultHistorySamples(samples, hours, startTimestamp, endTimestamp);
  const seen = new Set<string>();
  const entries: FaultHistoryEntry[] = [];

  for (const sample of selectedSamples) {
    const numericValue = normalizeNumericRawValue(sample.value);
    if (numericValue === null) {
      continue;
    }

    const field = findFieldByIdentifier(sample.identifier);
    const sourceIdentifier = field?.identifier || sample.identifier;
    const sourceLabel = field?.name || sample.identifier;
    const sourceDataType = field?.dataType || "UINT32";

    for (const entry of decodeFaultEntriesFromSource({
      identifier: sourceIdentifier,
      label: sourceLabel,
      dataType: sourceDataType,
      numericValue,
    })) {
      const key = [
        sample.timestamp,
        sample.sourceKey,
        entry.sourceIdentifier,
        entry.identifier,
        entry.identifierBit,
        entry.code,
        entry.rawHex,
      ].join(":");
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      entries.push({
        ...entry,
        timestamp: sample.timestamp,
        sourceKey: sample.sourceKey,
      });
    }
  }

  return sortDecodedFaults(entries);
}

function buildRecentDailySummaries(samples: MetricSample[]) {
  const grouped = new Map<
    string,
    {
      sampleCount: number;
      lastReportedAt: number | null;
      dailyGeneration: number | null;
      gridCharge: number | null;
      peakOutputPower: number | null;
    }
  >();

  for (const sample of samples) {
    if (typeof sample.value !== "number") {
      continue;
    }

    const localDay = new Date(sample.timestamp + DEVICE_KEY_TIMEZONE_OFFSET_MS).toISOString().slice(0, 10);
    const current = grouped.get(localDay) || {
      sampleCount: 0,
      lastReportedAt: null,
      dailyGeneration: null,
      gridCharge: null,
      peakOutputPower: null,
    };

    current.sampleCount += 1;
    if (!current.lastReportedAt || sample.timestamp > current.lastReportedAt) {
      current.lastReportedAt = sample.timestamp;
    }

    if (sample.identifier === "PVDailyENR") {
      current.dailyGeneration = current.dailyGeneration === null ? sample.value : Math.max(current.dailyGeneration, sample.value);
    }

    if (sample.identifier === "GridDailyENR") {
      current.gridCharge = current.gridCharge === null ? sample.value : Math.max(current.gridCharge, sample.value);
    }

    if (sample.identifier === "TotalOutP") {
      current.peakOutputPower = current.peakOutputPower === null ? sample.value : Math.max(current.peakOutputPower, sample.value);
    }

    grouped.set(localDay, current);
  }

  return [...grouped.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .slice(0, 3)
    .map(([day, summary]) => ({
      day,
      sampleCount: summary.sampleCount,
      lastReportedAt: summary.lastReportedAt,
      generation: formatValueByIdentifier("PVDailyENR", summary.dailyGeneration),
      gridCharge: formatValueByIdentifier("GridDailyENR", summary.gridCharge),
      peakOutputPower: formatValueByIdentifier("TotalOutP", summary.peakOutputPower),
    }));
}

function buildModuleCoverage(currentValues: CurrentMetricValue[]) {
  const available = new Set(currentValues.map((value) => normalizeMetricKey(value.identifier)));

  return objectModelModules.map((module) => {
    const matched = objectModelFields.filter(
      (field) => field.module === module.module && available.has(normalizeMetricKey(field.identifier)),
    ).length;

    return {
      module: module.module,
      total: module.count,
      available: matched,
      coverageRatio: module.count > 0 ? matched / module.count : 0,
    } satisfies ModuleCoverage;
  });
}

function createPayloadPreview(
  object: PlatformObjectPreview,
  source: PayloadPreview["source"],
  payload: unknown,
  payloadSamples: MetricSample[],
) {
  const uniqueFields = new Set(payloadSamples.map((sample) => sample.identifier));
  if (!uniqueFields.size) {
    return null;
  }

  const snippet = JSON.stringify(payload);
  return {
    bucket: object.bucket,
    key: object.key,
    deviceId: object.deviceId || extractDeviceId(snippet),
    timestamp:
      payloadSamples.reduce<number | null>(
        (latest, sample) => (latest === null || sample.timestamp > latest ? sample.timestamp : latest),
        null,
      ) || object.lastModified,
    source,
    classification: object.classification,
    fieldCount: uniqueFields.size,
    metricCount: payloadSamples.length,
    snippet: snippet.length > 360 ? `${snippet.slice(0, 360)}...` : snippet,
  } satisfies PayloadPreview;
}

function inferVersionFromText(value: string) {
  const versionMatch = value.match(/V\d+(?:\.\d+)+(?:_[A-Za-z0-9-]+)?/i);
  return versionMatch?.[0] || value.split("/").pop() || value;
}

function inferModuleFromKey(key: string) {
  if (/ems/i.test(key)) {
    return "ems";
  }

  if (/(^|\/)ac/i.test(key)) {
    return "ac";
  }

  if (/(^|\/)dc/i.test(key)) {
    return "dc";
  }

  if (/bms/i.test(key)) {
    return "bms";
  }

  return "misc";
}

function collectManifestArtifacts(
  object: PlatformObjectPreview,
  payload: unknown,
  artifacts: OtaArtifact[],
) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const record = payload as Record<string, unknown>;

  for (const [module, value] of Object.entries(record)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const manifestEntry = value as Record<string, unknown>;
    const url = typeof manifestEntry.url === "string" ? manifestEntry.url : null;
    if (!url) {
      continue;
    }

    artifacts.push({
      module,
      kind: "manifest",
      version: inferVersionFromText(url),
      bucket: object.bucket,
      key: object.key,
      deviceId: object.deviceId,
      size: object.size,
      lastModified: object.lastModified,
      url,
    });
  }
}

async function fetchObjectText(
  client: S3Client,
  object: PlatformObjectPreview,
  stats: QueryStats,
) {
  if (object.size > MAX_OBJECT_BYTES) {
    return null;
  }

  const cacheKey = `object:${object.bucket}:${object.key}:${object.etag || object.lastModified || object.size}`;
  const cached = readCache<ObjectTextPayload>(cacheKey);

  if (cached) {
    stats.cacheHits += 1;
    return cached;
  }

  stats.objectFetches += 1;
  const response = await client.send(
    new GetObjectCommand({
      Bucket: object.bucket,
      Key: object.key,
    }),
  );
  const text = await response.Body?.transformToString();
  if (!text) {
    return null;
  }

  const payload = {
    text,
    contentType: response.ContentType || null,
  };
  stats.bytesFetched += Buffer.byteLength(text);
  writeCache(cacheKey, payload);
  return payload;
}

async function fetchLocalObjectText(object: PlatformObjectPreview, stats: QueryStats) {
  if (!object.localPath || object.size > MAX_OBJECT_BYTES) {
    return null;
  }

  const cacheKey = `local-object:${object.localPath}:${object.lastModified || object.size}`;
  const cached = readCache<ObjectTextPayload>(cacheKey);

  if (cached) {
    stats.cacheHits += 1;
    return cached;
  }

  stats.objectFetches += 1;
  const text = await readFile(object.localPath, "utf8");
  if (!text) {
    return null;
  }

  const payload = {
    text,
    contentType: "application/json",
  };
  stats.bytesFetched += Buffer.byteLength(text);
  writeCache(cacheKey, payload);
  return payload;
}

async function extractLiveData(
  environment: PlatformEnvironment,
  selectedDeviceId: string | null,
  objects: PlatformObjectPreview[],
  stats: QueryStats,
  options?: {
    maxObjectsToFetch?: number;
    includePayloadPreviews?: boolean;
    includeArtifacts?: boolean;
    selectionStrategy?: "latest" | "balanced-by-day";
  },
) {
  const samples: MetricSample[] = [];
  const artifacts: OtaArtifact[] = [];
  const payloadPreviews: PayloadPreview[] = [];
  const client = hasAwsCredentials() && environment.buckets.length ? getS3Client(environment.region) : null;
  const maxObjectsToFetch = options?.maxObjectsToFetch ?? FETCH_BUDGET;
  const includePayloadPreviews = options?.includePayloadPreviews ?? true;
  const includeArtifacts = options?.includeArtifacts ?? true;
  const selectionStrategy = options?.selectionStrategy ?? "latest";
  const targetObjects = objects
    .filter((object) => {
      if (object.classification === "ota-binary" || object.classification === "other") {
        return false;
      }

      if (!includeArtifacts && object.classification === "ota-manifest") {
        return false;
      }

      if (
        selectedDeviceId &&
        (object.classification === "telemetry" || object.classification === "shadow") &&
        object.deviceId &&
        object.deviceId !== selectedDeviceId
      ) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const leftPriority = isIotDataObject(left) ? 0 : isIotDataErrorObject(left) ? 1 : 2;
      const rightPriority = isIotDataObject(right) ? 0 : isIotDataErrorObject(right) ? 1 : 2;
      return leftPriority - rightPriority || (getObjectEventTimestamp(right) || 0) - (getObjectEventTimestamp(left) || 0);
    });
  const limitedObjects = selectObjectsForParsing(targetObjects, maxObjectsToFetch, selectionStrategy);

  await forEachWithConcurrency(limitedObjects, OBJECT_FETCH_CONCURRENCY, async (object) => {
    try {
      const textPayload = isLocalObject(object)
        ? await fetchLocalObjectText(object, stats)
        : client
          ? await fetchObjectText(client, object, stats)
          : null;
      if (!textPayload) {
        return;
      }

      stats.objectsParsed += 1;
      const parsed = parseJsonLike(textPayload.text);
      const fallbackTimestamp = getObjectEventTimestamp(object) || Date.now();
      const payloadUnits = extractPayloadUnits(parsed);
      const inferredDeviceId = object.deviceId || extractDeviceId(textPayload.text);
      if (!object.deviceId && inferredDeviceId) {
        object.deviceId = inferredDeviceId;
      }
      const sourceKey =
        inferredDeviceId && !extractDeviceId(object.key) ? `${object.key}#${inferredDeviceId}` : object.key;

      for (const payloadUnit of payloadUnits) {
        const payloadSamples: MetricSample[] = [];
        collectMetricSamples(payloadUnit.payload, sourceKey, fallbackTimestamp, payloadSamples);
        samples.push(...payloadSamples);

        const preview = includePayloadPreviews ? createPayloadPreview(object, payloadUnit.source, payloadUnit.payload, payloadSamples) : null;
        if (preview && payloadPreviews.length < 10) {
          payloadPreviews.push(preview);
        }

        if (includeArtifacts && object.classification === "ota-manifest") {
          collectManifestArtifacts(object, payloadUnit.payload, artifacts);
        }
      }
    } catch {
      return;
    }
  });

  const binaryArtifacts = includeArtifacts
    ? objects
        .filter((object) => object.classification === "ota-binary")
        .filter((object) => !selectedDeviceId || object.deviceId === selectedDeviceId || object.bucket === sampleManifest.bucket)
        .slice(0, 12)
        .map((object) => ({
          module: inferModuleFromKey(object.key),
          kind: "binary" as const,
          version: inferVersionFromText(object.key),
          bucket: object.bucket,
          key: object.key,
          deviceId: object.deviceId,
          size: object.size,
          lastModified: object.lastModified,
          url: object.url,
        }))
    : [];

  return {
    samples,
    artifacts: dedupeArtifacts([...artifacts, ...binaryArtifacts]),
    payloadPreviews,
  };
}

function dedupeArtifacts(artifacts: OtaArtifact[]) {
  const seen = new Map<string, OtaArtifact>();

  for (const artifact of artifacts) {
    seen.set(`${artifact.kind}:${artifact.url || `${artifact.bucket}:${artifact.key}`}`, artifact);
  }

  return [...seen.values()].sort((left, right) => {
    return (right.lastModified || 0) - (left.lastModified || 0);
  });
}

function createSampleArtifacts(environment: PlatformEnvironment) {
  return sampleManifest.modules.map((module) => ({
    module: module.module,
    kind: "manifest" as const,
    version: module.version,
    bucket: sampleManifest.bucket,
    key: sampleManifest.key,
    deviceId: sampleManifest.deviceId,
    size: 325,
    lastModified: null,
    url:
      environment.key === "hk-test"
        ? module.url
        : module.url.replace("tuobang-iot-ota-dev.s3.ap-east-1.amazonaws.com", "configure-your-prod-bucket"),
  }));
}

function buildIngestionLanes(objects: PlatformObjectPreview[]) {
  const counts = {
    telemetry: objects.filter((object) => object.classification === "telemetry").length,
    otaManifest: objects.filter((object) => object.classification === "ota-manifest").length,
    otaBinary: objects.filter((object) => object.classification === "ota-binary").length,
    shadow: objects.filter((object) => object.classification === "shadow").length,
    other: objects.filter((object) => object.classification === "other").length,
  };

  return [
    {
      key: "telemetry",
      label: "Telemetry stream",
      objectCount: counts.telemetry,
      detail: "Decoded from iot-data, report, CSV, or similar device payload objects.",
    },
    {
      key: "ota-manifest",
      label: "OTA manifests",
      objectCount: counts.otaManifest,
      detail: "JSON instructions or notify payloads that describe firmware rollout targets.",
    },
    {
      key: "ota-binary",
      label: "Firmware binaries",
      objectCount: counts.otaBinary,
      detail: "Heavy binary artifacts are listed as metadata only to keep request costs predictable.",
    },
    {
      key: "shadow",
      label: "Shadow snapshots",
      objectCount: counts.shadow,
      detail: "Device shadow or state documents when those prefixes exist in the bucket layout.",
    },
    {
      key: "other",
      label: "Other objects",
      objectCount: counts.other,
      detail: "Reachable but not yet mapped into telemetry or OTA-specific views.",
    },
  ];
}

function isAccessDeniedError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string" &&
    error.name === "AccessDenied"
  );
}

function describeS3Error(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "The S3 request failed for this prefix.";
}

async function resolveSelectedDeviceObjects(
  environment: PlatformEnvironment,
  objects: PlatformObjectPreview[],
  selectedDeviceId: string,
  stats: QueryStats,
  dataSourceMode: "s3" | "local" | "none",
  datePrefixLimit: number,
) {
  let deviceObjects = objects.filter((object) => object.deviceId === selectedDeviceId);

  if (dataSourceMode === "s3" && selectedDeviceId && environment.buckets.length && hasAwsCredentials()) {
    const client = getS3Client(environment.region);
    const expandedObjects = await listSelectedDeviceObjects(
      client,
      environment,
      environment.buckets[0],
      selectedDeviceId,
      stats,
      datePrefixLimit,
    );

    deviceObjects = dedupeObjects([
      ...deviceObjects.filter((object) => !isDirectoryPreviewObject(object)),
      ...expandedObjects,
    ]);
  }

  return deviceObjects.sort((left, right) => (getObjectEventTimestamp(right) || 0) - (getObjectEventTimestamp(left) || 0));
}

async function extractOtaArtifacts(
  environment: PlatformEnvironment,
  objects: PlatformObjectPreview[],
  stats: QueryStats,
  selectedDeviceId: string | null,
) {
  const artifacts: OtaArtifact[] = [];
  const client = hasAwsCredentials() && environment.buckets.length ? getS3Client(environment.region) : null;
  const manifestObjects = objects
    .filter((object) => object.classification === "ota-manifest")
    .filter((object) => !selectedDeviceId || object.deviceId === selectedDeviceId || !object.deviceId)
    .slice(0, 18);

  await forEachWithConcurrency(manifestObjects, OBJECT_FETCH_CONCURRENCY, async (object) => {
    try {
      const textPayload = isLocalObject(object)
        ? await fetchLocalObjectText(object, stats)
        : client
          ? await fetchObjectText(client, object, stats)
          : null;
      if (!textPayload) {
        return;
      }

      stats.objectsParsed += 1;
      const parsed = parseJsonLike(textPayload.text);
      const payloadUnits = extractPayloadUnits(parsed);
      for (const payloadUnit of payloadUnits) {
        collectManifestArtifacts(object, payloadUnit.payload, artifacts);
      }
    } catch {
      return;
    }
  });

  const binaryArtifacts = objects
    .filter((object) => object.classification === "ota-binary")
    .filter((object) => !selectedDeviceId || object.deviceId === selectedDeviceId || object.bucket === sampleManifest.bucket)
    .slice(0, 12)
    .map((object) => ({
      module: inferModuleFromKey(object.key),
      kind: "binary" as const,
      version: inferVersionFromText(object.key),
      bucket: object.bucket,
      key: object.key,
      deviceId: object.deviceId,
      size: object.size,
      lastModified: object.lastModified,
      url: object.url,
    }));

  return dedupeArtifacts([...artifacts, ...binaryArtifacts]);
}

export async function getDashboardListState(query: DashboardQuery): Promise<DashboardListState> {
  const environments = getEnvironmentDefinitions();
  const selectedEnvironment = getSelectedEnvironment(query, environments);
  const deviceSearch = normalizeSearchTerm(query.deviceSearch);
  const deviceType = normalizeListDeviceType(query.deviceType);
  const pageSize = normalizePositiveInteger(query.pageSize, 10);
  const stats = createQueryStats();
  const notices: string[] = [];
  const { objects, bucketStatuses, localRootDir, dataSourceMode } = await listRelevantObjects(selectedEnvironment, stats);
  const deviceMetricCounts = await collectDeviceMetricCounts(selectedEnvironment, objects, stats);
  const allDeviceOptions = collectDeviceSummaries(objects, [], deviceMetricCounts);
  const filteredDeviceOptions = filterDeviceOptionsByType(filterDeviceOptionsBySearch(allDeviceOptions, deviceSearch, null), deviceType);
  const totalItems = filteredDeviceOptions.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(normalizePositiveInteger(query.page, 1), totalPages);
  const pagedDeviceOptions = filteredDeviceOptions.slice((page - 1) * pageSize, page * pageSize);
  const deniedBuckets = bucketStatuses.filter((bucket) => bucket.bucket !== "local-downloaded-files" && !bucket.accessible);

  if (dataSourceMode === "s3") {
    notices.push(`当前正在直连 S3：${selectedEnvironment.buckets.join(", ")}，首页仅加载设备列表与轻量状态。`);
  } else if (dataSourceMode === "local" && localRootDir) {
    notices.push(`当前实时 S3 没有返回可用数据，已切换到本地兜底目录：${localRootDir}`);
  } else if (!hasAwsCredentials()) {
    notices.push("当前没有 AWS 访问凭证，请先在 .env.local 中配置 Access Key。");
  }

  if (!selectedEnvironment.buckets.length && !localRootDir) {
    notices.push("当前环境没有配置 S3 桶，也没有配置本地下载目录。");
  }

  if (!objects.length) {
    notices.push("当前没有发现可处理的 iot-data 对象，请确认桶权限、前缀或时间范围。");
  }

  if (deniedBuckets.length > 0) {
    notices.push(`当前 IAM Key 仍无法读取这些已配置桶：${deniedBuckets.map((bucket) => bucket.bucket).join(", ")}。`);
  }

  return {
    environments,
    selectedEnvironment,
    dataSourceMode,
    deviceSearch,
    deviceType,
    page,
    pageSize,
    totalItems,
    totalPages,
    deviceOptions: pagedDeviceOptions,
    fleetSummary: buildDashboardFleetSummary(allDeviceOptions),
    queryStats: stats,
    configStatus: buildDashboardConfigStatus(selectedEnvironment, bucketStatuses, localRootDir),
    notices,
  };
}

export async function getSupportWorkbenchState(query: DashboardQuery): Promise<SupportWorkbenchState> {
  const environments = getEnvironmentDefinitions();
  const selectedEnvironment = getSelectedEnvironment(query, environments);
  const stats = createQueryStats();
  const notices: string[] = [];
  const { objects, bucketStatuses, localRootDir, dataSourceMode } = await listRelevantObjects(selectedEnvironment, stats);
  const deviceMetricCounts = await collectDeviceMetricCounts(selectedEnvironment, objects, stats);
  const deviceOptions = collectDeviceSummaries(objects, [], deviceMetricCounts);
  const deniedBuckets = bucketStatuses.filter((bucket) => bucket.bucket !== "local-downloaded-files" && !bucket.accessible);

  if (dataSourceMode === "s3") {
    notices.push(`当前正在直连 S3：${selectedEnvironment.buckets.join(", ")}，服务工具优先展示待跟进设备和快速诊断能力。`);
  } else if (dataSourceMode === "local" && localRootDir) {
    notices.push(`当前实时 S3 没有返回可用数据，已切换到本地兜底目录：${localRootDir}`);
  } else if (!hasAwsCredentials()) {
    notices.push("当前没有 AWS 访问凭证，请先在 .env.local 中配置 Access Key。");
  }

  if (!selectedEnvironment.buckets.length && !localRootDir) {
    notices.push("当前环境没有配置 S3 桶，也没有配置本地下载目录。");
  }

  if (!objects.length) {
    notices.push("当前没有发现可处理的 iot-data 对象，请确认桶权限、前缀或时间范围。");
  }

  if (deniedBuckets.length > 0) {
    notices.push(`当前 IAM Key 仍无法读取这些已配置桶：${deniedBuckets.map((bucket) => bucket.bucket).join(", ")}。`);
  }

  return {
    environments,
    selectedEnvironment,
    dataSourceMode,
    summary: buildSupportWorkbenchSummary(deviceOptions),
    followUpDevices: buildSupportFollowUpDevices(deviceOptions),
    queryStats: stats,
    configStatus: buildDashboardConfigStatus(selectedEnvironment, bucketStatuses, localRootDir),
    notices,
  };
}

export async function getDashboardDetailState(query: DashboardQuery): Promise<DashboardDetailState> {
  const environments = getEnvironmentDefinitions();
  const selectedEnvironment = getSelectedEnvironment(query, environments);
  const selectedDeviceId = normalizeSearchTerm(query.deviceId) || null;
  const startAt = normalizeSearchTerm(query.startAt);
  const endAt = normalizeSearchTerm(query.endAt);
  const startTimestamp = parseDateTimeInput(startAt);
  const endTimestamp = parseDateTimeInput(endAt);
  const historyWindowHours = DEFAULT_HISTORY_WINDOW_HOURS;
  const selectedDeviceDateLimit = getSelectedDeviceDateLimit(
    historyWindowHours,
    startTimestamp,
    endTimestamp,
    RECENT_IOT_DATE_LIMIT,
  );
  const stats = createQueryStats(FETCH_BUDGET);
  const notices: string[] = [];
  const { objects, bucketStatuses, localRootDir, dataSourceMode } = await listRelevantObjects(selectedEnvironment, stats);

  if (!selectedDeviceId) {
    notices.push("当前没有选中的设备，请先从设备列表进入详情。");
    return {
      environments,
      selectedEnvironment,
      dataSourceMode,
      selectedDeviceId: null,
      selectedDevice: null,
      selectedMetricId: null,
      historyWindowHours,
      currentValues: [],
      decodedFaults: [],
      historySeries: [],
      metricOptions: [],
      recentDailySummaries: [],
      queryStats: stats,
      configStatus: buildDashboardConfigStatus(selectedEnvironment, bucketStatuses, localRootDir),
      notices,
    };
  }

  const deviceObjects = await resolveSelectedDeviceObjects(
    selectedEnvironment,
    objects,
    selectedDeviceId,
    stats,
    dataSourceMode,
    selectedDeviceDateLimit,
  );
  stats.objectsDiscovered = deviceObjects.length;

  const liveData = await extractLiveData(selectedEnvironment, selectedDeviceId, deviceObjects, stats, {
    includeArtifacts: false,
    includePayloadPreviews: false,
    maxObjectsToFetch: FETCH_BUDGET,
    selectionStrategy: "balanced-by-day",
  });
  const rangedSamples = filterSamplesByRange(liveData.samples, startTimestamp, endTimestamp);
  const rawCurrentValues = buildCurrentValues(rangedSamples);
  const currentValues = rawCurrentValues;
  const decodedFaults = decodeActiveFaults(rawCurrentValues);
  const selectedDevice = collectDeviceSummaries(deviceObjects, liveData.samples)[0] || null;
  const recentDailySummaries = buildRecentDailySummaries(liveData.samples);

  if (dataSourceMode === "s3") {
    notices.push(`当前正在直连 S3：${selectedEnvironment.buckets.join(", ")}，详情仅按需加载当前设备。`);
  } else if (dataSourceMode === "local" && localRootDir) {
    notices.push(`当前实时 S3 没有返回可用数据，已切换到本地兜底目录：${localRootDir}`);
  } else if (!hasAwsCredentials()) {
    notices.push("当前没有 AWS 访问凭证，请先在 .env.local 中配置 Access Key。");
  }

  if (!deviceObjects.length) {
    notices.push("当前设备在所选环境中没有发现可解析的对象。");
  }

  if (!rawCurrentValues.length) {
    notices.push("当前还没有从 iot-data 样本中解析出设备字段，请确认对象正文里包含 state.reported 或物模型字段。");
  }

  return {
    environments,
    selectedEnvironment,
    dataSourceMode,
    selectedDeviceId,
    selectedDevice,
    selectedMetricId: null,
    historyWindowHours,
    currentValues,
    decodedFaults,
    historySeries: [],
    metricOptions: [],
    recentDailySummaries,
    queryStats: stats,
    configStatus: buildDashboardConfigStatus(selectedEnvironment, bucketStatuses, localRootDir),
    notices,
  };
}

export async function getDashboardState(query: DashboardQuery): Promise<DashboardState> {
  const environments = getEnvironmentDefinitions();
  const selectedEnvironment = getSelectedEnvironment(query, environments);
  const deviceSearch = normalizeSearchTerm(query.deviceSearch);
  const fieldSearch = normalizeSearchTerm(query.fieldSearch);
  const startAt = normalizeSearchTerm(query.startAt);
  const endAt = normalizeSearchTerm(query.endAt);
  const startTimestamp = parseDateTimeInput(startAt);
  const endTimestamp = parseDateTimeInput(endAt);
  const historyWindowHours =
    query.hours === 0 || [6, 24, 72, 168].includes(query.hours || 0) ? (query.hours as number) : DEFAULT_HISTORY_WINDOW_HOURS;
  const selectedDeviceDateLimit = getSelectedDeviceDateLimit(
    historyWindowHours,
    startTimestamp,
    endTimestamp,
    RECENT_IOT_DATE_LIMIT,
  );
  const stats: QueryStats = {
    listRequests: 0,
    objectFetches: 0,
    objectsDiscovered: 0,
    objectsParsed: 0,
    bytesFetched: 0,
    cacheHits: 0,
    listBudget: LIST_BUDGET,
    fetchBudget: FETCH_BUDGET,
  };
  const notices: string[] = [];

  const { objects, bucketStatuses, localRootDir, dataSourceMode } = await listRelevantObjects(selectedEnvironment, stats);
  const deviceMetricCounts = await collectDeviceMetricCounts(selectedEnvironment, objects, stats);
  const firstPassDevices = collectDeviceSummaries(objects, [], deviceMetricCounts);
  const selectedDeviceId = normalizeSearchTerm(query.deviceId) || null;
  let effectiveObjects = objects;

  if (dataSourceMode === "s3" && selectedDeviceId && selectedEnvironment.buckets.length && hasAwsCredentials()) {
    const client = getS3Client(selectedEnvironment.region);
    const expandedObjects = await listSelectedDeviceObjects(
      client,
      selectedEnvironment,
      selectedEnvironment.buckets[0],
      selectedDeviceId,
      stats,
      selectedDeviceDateLimit,
    );

    effectiveObjects = dedupeObjects([
      ...objects.filter((object) => !(isDirectoryPreviewObject(object) && object.deviceId === selectedDeviceId)),
      ...expandedObjects,
    ]).sort((left, right) => (getObjectEventTimestamp(right) || 0) - (getObjectEventTimestamp(left) || 0));
  }

  stats.objectsDiscovered = effectiveObjects.length;

  const liveData = selectedDeviceId
    ? await extractLiveData(selectedEnvironment, selectedDeviceId, effectiveObjects, stats, {
        includeArtifacts: false,
        includePayloadPreviews: false,
        maxObjectsToFetch: FETCH_BUDGET,
      })
    : {
        samples: [] as MetricSample[],
        artifacts: [] as OtaArtifact[],
        payloadPreviews: [] as PayloadPreview[],
      };
  const allDeviceOptions = selectedDeviceId ? collectDeviceSummaries(effectiveObjects, liveData.samples, deviceMetricCounts) : firstPassDevices;
  const selectedDevice = selectedDeviceId ? allDeviceOptions.find((device) => device.id === selectedDeviceId) || null : null;
  const rangedSamples = selectedDeviceId ? filterSamplesByRange(liveData.samples, startTimestamp, endTimestamp) : ([] as MetricSample[]);
  const rangedPayloadPreviews = selectedDeviceId
    ? filterPayloadPreviewsByRange(liveData.payloadPreviews, startTimestamp, endTimestamp)
    : ([] as PayloadPreview[]);
  const rangedObjects = selectedDeviceId
    ? filterObjectsByRange(effectiveObjects, startTimestamp, endTimestamp).filter((object) => !isDirectoryPreviewObject(object))
    : ([] as PlatformObjectPreview[]);
  const rawCurrentValues = selectedDeviceId ? buildCurrentValues(rangedSamples) : ([] as CurrentMetricValue[]);
  const currentValues = selectedDeviceId ? filterCurrentValuesBySearch(rawCurrentValues, fieldSearch) : ([] as CurrentMetricValue[]);
  const decodedFaults = selectedDeviceId ? decodeActiveFaults(rawCurrentValues) : ([] as DecodedFaultEntry[]);
  const metricOptions = selectedDeviceId
    ? filterMetricOptionsBySearch(buildMetricOptions(rangedSamples), fieldSearch)
    : ([] as Array<{ identifier: string; label: string }>);
  const selectedMetricId = selectedDeviceId
    ? metricOptions.find((metric) => metric.identifier === query.metricId)?.identifier || metricOptions[0]?.identifier || null
    : null;
  const historySeries = selectedDeviceId
    ? buildHistorySeries(rangedSamples, selectedMetricId, historyWindowHours, startTimestamp, endTimestamp)
    : ([] as MetricHistoryPoint[]);
  const moduleCoverage = selectedDeviceId ? buildModuleCoverage(rawCurrentValues) : ([] as ModuleCoverage[]);
  const deviceOptions = filterDeviceOptionsBySearch(allDeviceOptions, deviceSearch, selectedDevice?.id || selectedDeviceId);
  const recentDailySummaries = selectedDeviceId ? buildRecentDailySummaries(liveData.samples) : [];
  const latestCurrentValueTimestamp = rawCurrentValues.reduce<number | null>((latest, item) => {
    if (!item.timestamp) {
      return latest;
    }

    return latest === null || item.timestamp > latest ? item.timestamp : latest;
  }, null);

  if (selectedDevice && latestCurrentValueTimestamp && (!selectedDevice.lastSeen || latestCurrentValueTimestamp > selectedDevice.lastSeen)) {
    selectedDevice.lastSeen = latestCurrentValueTimestamp;
    const selectedOption = deviceOptions.find((device) => device.id === selectedDevice.id);
    if (selectedOption) {
      selectedOption.lastSeen = latestCurrentValueTimestamp;
    }
  }

  const localBuckets = bucketStatuses.filter((bucket) => bucket.bucket === "local-downloaded-files");
  const deniedBuckets = bucketStatuses.filter((bucket) => bucket.bucket !== "local-downloaded-files" && !bucket.accessible);
  notices.length = 0;

  if (dataSourceMode === "s3") {
    notices.push(`当前正在直连 S3：${selectedEnvironment.buckets.join(", ")}，优先读取 iot-data/ 实时对象。`);
  } else if (dataSourceMode === "local" && localRootDir) {
    notices.push(`当前实时 S3 没有返回可用数据，已切换到本地兜底目录：${localRootDir}`);
  } else if (!hasAwsCredentials()) {
    notices.push("当前没有 AWS 访问凭证，请先在 .env.local 中配置 Access Key。");
  }

  if (!selectedEnvironment.buckets.length && !localRootDir) {
    notices.push("当前环境没有配置 S3 桶，也没有配置本地下载目录。");
  }

  if (startTimestamp !== null && endTimestamp !== null && startTimestamp > endTimestamp) {
    notices.push("开始时间晚于结束时间，请重新选择。");
  }

  if (!effectiveObjects.length) {
    notices.push("当前没有发现可处理的 iot-data 对象，请确认桶权限、前缀或时间范围。");
  }

  if (selectedDeviceId && !rawCurrentValues.length) {
    notices.push("当前还没有从 iot-data 样本中解析出设备字段，请确认对象正文里包含 state.reported 或物模型字段。");
  }

  if (selectedDeviceId && (startTimestamp !== null || endTimestamp !== null) && !rangedSamples.length) {
    notices.push("当前时间范围内没有匹配到已解析的遥测样本。");
  }

  if (selectedDeviceId && fieldSearch && !currentValues.length) {
    notices.push("当前字段搜索没有匹配到任何已解析字段。");
  }

  if (deviceSearch && !deviceOptions.length) {
    notices.push("当前设备搜索没有匹配到任何设备。");
  }

  if (deniedBuckets.length > 0) {
    notices.push(`当前 IAM Key 仍无法读取这些已配置桶：${deniedBuckets.map((bucket) => bucket.bucket).join(", ")}。`);
  }

  if (dataSourceMode === "s3" && localBuckets.some((bucket) => bucket.accessible)) {
    notices.push("已检测到本地兜底目录，但当前页面实际使用的是实时 S3 数据。");
  }

  if (dataSourceMode === "local" && localBuckets.length === 0 && localRootDir) {
    notices.push("本地目录已配置，但当前没有命中任何可识别的 iot-data 文件。");
  }

  const otaArtifacts = selectedDeviceId
    ? liveData.artifacts.length
      ? liveData.artifacts
      : createSampleArtifacts(selectedEnvironment)
    : [];

  return {
    environments,
    selectedEnvironment,
    dataSourceMode,
    selectedDeviceId: selectedDevice?.id || selectedDeviceId,
    selectedMetricId,
    deviceSearch,
    fieldSearch,
    startAt,
    endAt,
    historyWindowHours,
    deviceOptions,
    selectedDevice,
    currentValues,
    decodedFaults,
    historySeries,
    metricOptions,
    otaArtifacts,
    recentObjects: selectedDeviceId ? rangedObjects.slice(0, 14) : [],
    moduleCoverage,
    bucketStatuses,
    ingestionLanes: selectedDeviceId ? buildIngestionLanes(rangedObjects) : [],
    payloadPreviews: selectedDeviceId ? rangedPayloadPreviews : [],
    recentDailySummaries,
    queryStats: stats,
    configStatus: {
      hasAwsCredentials: hasAwsCredentials(),
      hasBucketConfig: selectedEnvironment.buckets.length > 0 || Boolean(localRootDir),
      liveAccessReady: bucketStatuses.some((bucket) => bucket.accessible),
    },
    notices,
  };
}

export async function getDashboardHistoryState(query: DashboardQuery): Promise<DashboardHistoryState> {
  const environments = getEnvironmentDefinitions();
  const selectedEnvironment = getSelectedEnvironment(query, environments);
  const startAt = normalizeSearchTerm(query.startAt);
  const endAt = normalizeSearchTerm(query.endAt);
  const startTimestamp = parseDateTimeInput(startAt);
  const endTimestamp = parseDateTimeInput(endAt);
  const explicitRangeApplied = startTimestamp !== null || endTimestamp !== null;
  const historyWindowHours =
    query.hours === 0 || [6, 24, 72, 168].includes(query.hours || 0) ? (query.hours as number) : DEFAULT_HISTORY_WINDOW_HOURS;
  const selectedDeviceDateLimit = getSelectedDeviceDateLimit(
    historyWindowHours,
    startTimestamp,
    endTimestamp,
    HISTORY_FULL_CYCLE_DATE_LIMIT,
  );
  const historyObjectFetchLimit = getHistoryObjectFetchLimit(selectedDeviceDateLimit);
  const stats: QueryStats = {
    listRequests: 0,
    objectFetches: 0,
    objectsDiscovered: 0,
    objectsParsed: 0,
    bytesFetched: 0,
    cacheHits: 0,
    listBudget: LIST_BUDGET,
    fetchBudget: historyObjectFetchLimit,
  };
  const notices: string[] = [];
  const { objects, dataSourceMode } = await listRelevantObjects(selectedEnvironment, stats);
  const firstPassDevices = collectDeviceSummaries(objects, []);
  const selectedDeviceId = query.deviceId || firstPassDevices[0]?.id || null;
  let effectiveObjects = objects;

  if (dataSourceMode === "s3" && selectedDeviceId && selectedEnvironment.buckets.length && hasAwsCredentials()) {
    const client = getS3Client(selectedEnvironment.region);
    const perDayObjectLimit = explicitRangeApplied || historyWindowHours === 0 ? null : HISTORY_SELECTED_DEVICE_OBJECTS_PER_DAY;
    const expandedObjects = await listSelectedDeviceObjects(
      client,
      selectedEnvironment,
      selectedEnvironment.buckets[0],
      selectedDeviceId,
      stats,
      selectedDeviceDateLimit,
      perDayObjectLimit,
    );

    effectiveObjects = dedupeObjects([
      ...objects.filter((object) => !(isDirectoryPreviewObject(object) && object.deviceId === selectedDeviceId)),
      ...expandedObjects,
    ]).sort((left, right) => (getObjectEventTimestamp(right) || 0) - (getObjectEventTimestamp(left) || 0));
  }

  stats.objectsDiscovered = effectiveObjects.length;

  const liveData = await extractLiveData(selectedEnvironment, selectedDeviceId, effectiveObjects, stats, {
    includeArtifacts: false,
    includePayloadPreviews: false,
    maxObjectsToFetch: historyObjectFetchLimit,
    selectionStrategy: selectedDeviceDateLimit > 2 ? "balanced-by-day" : "latest",
  });
  const rangedSamples = filterSamplesByRange(liveData.samples, startTimestamp, endTimestamp);
  const metricOptions = buildMetricOptions(rangedSamples);
  const selectedMetricId =
    metricOptions.find((metric) => metric.identifier === query.metricId)?.identifier ||
    metricOptions[0]?.identifier ||
    null;
  const rawHistorySeries = selectMetricHistorySeries(rangedSamples, selectedMetricId, historyWindowHours, startTimestamp, endTimestamp);
  const historySeries = compressSeries(rawHistorySeries);

  if (!selectedDeviceId) {
    notices.push("当前没有可查看曲线的设备。");
  }

  if (!historySeries.length) {
    notices.push("当前时间范围内没有匹配到可绘制曲线的历史点。");
  }

  return {
    selectedEnvironment,
    dataSourceMode,
    selectedDeviceId,
    selectedMetricId,
    historySeries,
    rawHistorySeries,
    metricOptions,
    queryStats: stats,
    notices,
  };
}

export async function getDashboardFaultHistoryState(query: DashboardQuery): Promise<DashboardFaultHistoryState> {
  const environments = getEnvironmentDefinitions();
  const selectedEnvironment = getSelectedEnvironment(query, environments);
  const startAt = normalizeSearchTerm(query.startAt);
  const endAt = normalizeSearchTerm(query.endAt);
  const startTimestamp = parseDateTimeInput(startAt);
  const endTimestamp = parseDateTimeInput(endAt);
  const historyWindowHours = query.hours === 0 || [6, 24, 72, 168].includes(query.hours || 0) ? (query.hours as number) : 72;
  const selectedDeviceDateLimit = getSelectedDeviceDateLimit(
    historyWindowHours,
    startTimestamp,
    endTimestamp,
    HISTORY_FULL_CYCLE_DATE_LIMIT,
  );
  const historyObjectFetchLimit = getHistoryObjectFetchLimit(selectedDeviceDateLimit);
  const stats: QueryStats = {
    listRequests: 0,
    objectFetches: 0,
    objectsDiscovered: 0,
    objectsParsed: 0,
    bytesFetched: 0,
    cacheHits: 0,
    listBudget: LIST_BUDGET,
    fetchBudget: historyObjectFetchLimit,
  };
  const notices: string[] = [];
  const { objects, dataSourceMode } = await listRelevantObjects(selectedEnvironment, stats);
  const firstPassDevices = collectDeviceSummaries(objects, []);
  const selectedDeviceId = query.deviceId || firstPassDevices[0]?.id || null;
  let effectiveObjects = objects;

  if (dataSourceMode === "s3" && selectedDeviceId && selectedEnvironment.buckets.length && hasAwsCredentials()) {
    const client = getS3Client(selectedEnvironment.region);
    const expandedObjects = await listSelectedDeviceObjects(
      client,
      selectedEnvironment,
      selectedEnvironment.buckets[0],
      selectedDeviceId,
      stats,
      selectedDeviceDateLimit,
    );

    effectiveObjects = dedupeObjects([
      ...objects.filter((object) => !(isDirectoryPreviewObject(object) && object.deviceId === selectedDeviceId)),
      ...expandedObjects,
    ]).sort((left, right) => (getObjectEventTimestamp(right) || 0) - (getObjectEventTimestamp(left) || 0));
  }

  stats.objectsDiscovered = effectiveObjects.length;

  const liveData = await extractLiveData(selectedEnvironment, selectedDeviceId, effectiveObjects, stats, {
    includeArtifacts: false,
    includePayloadPreviews: false,
    maxObjectsToFetch: historyObjectFetchLimit,
    selectionStrategy: selectedDeviceDateLimit > 2 ? "balanced-by-day" : "latest",
  });
  const faultHistory = buildFaultHistoryEntries(liveData.samples, historyWindowHours, startTimestamp, endTimestamp);

  if (!selectedDeviceId) {
    notices.push("当前没有可查看故障历史的设备。");
  }

  if (!faultHistory.length) {
    notices.push("当前时间范围内没有匹配到故障历史。");
  }

  return {
    selectedEnvironment,
    dataSourceMode,
    selectedDeviceId,
    historyWindowHours,
    startAt,
    endAt,
    faultHistory,
    queryStats: stats,
    notices,
  };
}
