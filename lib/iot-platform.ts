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
  findFieldByIdentifier,
  getFieldDisplayName,
  getPreferredMetricIdentifiers,
  normalizeMetricKey,
  objectModelFields,
  objectModelModules,
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
  objectCount: number;
  otaCount: number;
  metricCount: number;
  lastSeen: number | null;
  sampleKeys: string[];
};

export type CurrentMetricValue = {
  identifier: string;
  label: string;
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
  historySeries: MetricHistoryPoint[];
  metricOptions: Array<{ identifier: string; label: string }>;
  otaArtifacts: OtaArtifact[];
  recentObjects: PlatformObjectPreview[];
  moduleCoverage: ModuleCoverage[];
  bucketStatuses: BucketStatus[];
  ingestionLanes: IngestionLane[];
  payloadPreviews: PayloadPreview[];
  recentDailySummaries: Array<{
    day: string;
    sampleCount: number;
    lastReportedAt: number | null;
    generation: string;
    gridCharge: string;
    peakOutputPower: string;
  }>;
  queryStats: QueryStats;
  configStatus: {
    hasAwsCredentials: boolean;
    hasBucketConfig: boolean;
    liveAccessReady: boolean;
  };
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

type MetricSample = {
  identifier: string;
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
  }
>;

export type DashboardQuery = {
  environment?: string;
  deviceId?: string;
  metricId?: string;
  deviceSearch?: string;
  fieldSearch?: string;
  startAt?: string;
  endAt?: string;
  hours?: number;
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
const HISTORY_FETCH_BUDGET = 64;
const CACHE_TTL_MS = 60_000;
const MAX_OBJECT_BYTES = 1_500_000;
const MAX_HISTORY_POINTS = 56;
const DEFAULT_LOCAL_DATA_ROOT = path.join(process.cwd(), ".local-data", "iot-downloads");
const LOCAL_FILE_LIMIT = 160;
const RECENT_IOT_DATE_LIMIT = 10;
const HISTORY_FULL_CYCLE_DATE_LIMIT = 30;
const COMMON_PREFIX_LIMIT = 180;
const SELECTED_DEVICE_OBJECTS_PER_DAY = 60;
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

function splitCsv(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSearchTerm(value: string | undefined) {
  return (value || "").trim();
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
) {
  const rootPrefix = environment.prefixHints.find((prefix) => prefix.startsWith("iot-data/")) || "iot-data/";
  const datePrefixes = await listCommonPrefixes(client, environment, bucket, rootPrefix, COMMON_PREFIX_LIMIT, stats);
  const recentDatePrefixes = [...datePrefixes]
    .sort((left, right) => (parseDatePrefixTimestamp(right) || 0) - (parseDatePrefixTimestamp(left) || 0))
    .slice(0, datePrefixLimit);

  const objects: PlatformObjectPreview[] = [];

  for (const datePrefix of recentDatePrefixes) {
    const devicePrefix = `${datePrefix}${selectedDeviceId}/`;
    const deviceObjects = await listLatestBucketObjects(
      client,
      environment,
      bucket,
      devicePrefix,
      SELECTED_DEVICE_OBJECTS_PER_DAY,
      stats,
    );
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
  const cached = readCache<Record<string, { metricCount: number; lastReportedAt: number | null }>>(cacheKey);

  if (cached) {
    stats.cacheHits += 1;
    return new Map(Object.entries(cached)) as DeviceLiveSnapshotMap;
  }

  const representativeObjects = await resolveRepresentativeObjectsForDevices(environment, objects, stats);
  if (!representativeObjects.length) {
    return new Map<string, { metricCount: number; lastReportedAt: number | null }>() as DeviceLiveSnapshotMap;
  }

  const counts = new Map<string, Set<string>>();
  const timestamps = new Map<string, number | null>();
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
  for (const sample of samples) {
    const sourceDeviceId = extractDeviceId(sample.sourceKey);
    if (!sourceDeviceId) {
      continue;
    }

    const bucket = sampleCounts.get(sourceDeviceId) || new Set<string>();
    bucket.add(sample.identifier);
    sampleCounts.set(sourceDeviceId, bucket);
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
        existing.lastSeen = snapshot.lastReportedAt || existing.lastSeen;
      }
    }
  }

  if (!grouped.size) {
    grouped.set(sampleManifest.deviceId, {
      id: sampleManifest.deviceId,
      label: `${sampleManifest.deviceId} (sample OTA)`,
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
  const cacheKey = `latest-list:${environment.key}:${bucket}:${prefix}:${limit}`;
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
      MaxKeys: 1000,
    }),
  );
  const objects = (response.Contents || [])
    .map((item) => normalizeObject(item, bucket, environment))
    .sort((left, right) => (getObjectEventTimestamp(right) || 0) - (getObjectEventTimestamp(left) || 0))
    .slice(0, limit);
  writeCache(cacheKey, objects);
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
): MetricSample | null {
  const value = coerceScalar(rawValue);
  if (value === undefined) {
    return null;
  }

  return {
    identifier: field.identifier,
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
    const field = findFieldByIdentifier(key);
    if (!field) {
      continue;
    }

    const sample = resolveFieldSample(field, value, recordTimestamp, sourceKey);
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
    const digits = field.step && field.step < 1 ? 2 : 0;
    const formatted = new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(rawValue);
    return field.unit ? `${formatted} ${field.unit}` : formatted;
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
        identifier: field.identifier,
        label: field.name,
        module: field.module,
        access: field.access,
        dataType: field.dataType,
        unit: field.unit,
        rawValue: sample.value,
        value: formatMetricValue(field, sample.value),
        timestamp: sample.timestamp,
        sourceKey: sample.sourceKey,
      };
    })
    .filter((item): item is CurrentMetricValue => item !== null)
    .sort((left, right) => left.module.localeCompare(right.module) || left.identifier.localeCompare(right.identifier));
}

function compressSeries(series: MetricHistoryPoint[]) {
  if (series.length <= MAX_HISTORY_POINTS) {
    return series;
  }

  const bucketSize = Math.ceil(series.length / MAX_HISTORY_POINTS);
  const points: MetricHistoryPoint[] = [];

  for (let index = 0; index < series.length; index += bucketSize) {
    const bucket = series.slice(index, index + bucketSize);
    const latest = bucket[bucket.length - 1];
    points.push(latest);
  }

  return points;
}

function buildMetricOptions(samples: MetricSample[]) {
  const metricSet = new Set<string>();

  for (const sample of samples) {
    if (typeof sample.value === "number") {
      metricSet.add(sample.identifier);
    }
  }

  const metrics = [...metricSet];
  const preferred = getPreferredMetricIdentifiers().filter((identifier) => metricSet.has(identifier));
  const ordered = [...new Set([...preferred, ...metrics.sort()])];

  return ordered.map((identifier) => ({
    identifier,
    label: getFieldDisplayName(identifier),
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
    .map((sample) => ({
      timestamp: sample.timestamp,
      value: sample.value as number,
    }))
    .sort((left, right) => left.timestamp - right.timestamp);

  if (!metricSamples.length) {
    return [] as MetricHistoryPoint[];
  }

  const explicitRangeApplied = startTimestamp !== null || endTimestamp !== null;
  return explicitRangeApplied
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
  },
) {
  const samples: MetricSample[] = [];
  const artifacts: OtaArtifact[] = [];
  const payloadPreviews: PayloadPreview[] = [];
  const client = hasAwsCredentials() && environment.buckets.length ? getS3Client(environment.region) : null;
  const maxObjectsToFetch = options?.maxObjectsToFetch ?? FETCH_BUDGET;
  const includePayloadPreviews = options?.includePayloadPreviews ?? true;
  const includeArtifacts = options?.includeArtifacts ?? true;
  const targetObjects = objects
    .filter((object) => {
      if (object.classification === "ota-binary" || object.classification === "other") {
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
  const limitedObjects = targetObjects.slice(0, maxObjectsToFetch);

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

export async function getDashboardState(query: DashboardQuery): Promise<DashboardState> {
  const environments = getEnvironmentDefinitions();
  const selectedEnvironment = getSelectedEnvironment(query, environments);
  const deviceSearch = normalizeSearchTerm(query.deviceSearch);
  const fieldSearch = normalizeSearchTerm(query.fieldSearch);
  const startAt = normalizeSearchTerm(query.startAt);
  const endAt = normalizeSearchTerm(query.endAt);
  const startTimestamp = parseDateTimeInput(startAt);
  const endTimestamp = parseDateTimeInput(endAt);
  const historyWindowHours = query.hours === 0 || [6, 24, 72, 168].includes(query.hours || 0) ? (query.hours as number) : 24;
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
    maxObjectsToFetch: FETCH_BUDGET,
  });
  const allDeviceOptions = collectDeviceSummaries(effectiveObjects, liveData.samples, deviceMetricCounts);
  const selectedDevice = allDeviceOptions.find((device) => device.id === selectedDeviceId) || allDeviceOptions[0] || null;
  const rangedSamples = filterSamplesByRange(liveData.samples, startTimestamp, endTimestamp);
  const rangedPayloadPreviews = filterPayloadPreviewsByRange(liveData.payloadPreviews, startTimestamp, endTimestamp);
  const rangedObjects = filterObjectsByRange(effectiveObjects, startTimestamp, endTimestamp).filter(
    (object) => !isDirectoryPreviewObject(object),
  );
  const rawCurrentValues = buildCurrentValues(rangedSamples);
  const currentValues = filterCurrentValuesBySearch(rawCurrentValues, fieldSearch);
  const metricOptions = filterMetricOptionsBySearch(buildMetricOptions(rangedSamples), fieldSearch);
  const selectedMetricId =
    metricOptions.find((metric) => metric.identifier === query.metricId)?.identifier ||
    metricOptions[0]?.identifier ||
    null;
  const historySeries = buildHistorySeries(rangedSamples, selectedMetricId, historyWindowHours, startTimestamp, endTimestamp);
  const moduleCoverage = buildModuleCoverage(rawCurrentValues);
  const deviceOptions = filterDeviceOptionsBySearch(allDeviceOptions, deviceSearch, selectedDevice?.id || selectedDeviceId);
  const recentDailySummaries = buildRecentDailySummaries(liveData.samples);
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

  if (!rawCurrentValues.length) {
    notices.push("当前还没有从 iot-data 样本中解析出设备字段，请确认对象正文里包含 state.reported 或物模型字段。");
  }

  if ((startTimestamp !== null || endTimestamp !== null) && !rangedSamples.length) {
    notices.push("当前时间范围内没有匹配到已解析的遥测样本。");
  }

  if (fieldSearch && !currentValues.length) {
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

  const otaArtifacts = liveData.artifacts.length ? liveData.artifacts : createSampleArtifacts(selectedEnvironment);

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
    historySeries,
    metricOptions,
    otaArtifacts,
    recentObjects: rangedObjects.slice(0, 14),
    moduleCoverage,
    bucketStatuses,
    ingestionLanes: buildIngestionLanes(rangedObjects),
    payloadPreviews: rangedPayloadPreviews,
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
  const historyWindowHours = query.hours === 0 || [6, 24, 72, 168].includes(query.hours || 0) ? (query.hours as number) : 24;
  const selectedDeviceDateLimit = getSelectedDeviceDateLimit(
    historyWindowHours,
    startTimestamp,
    endTimestamp,
    HISTORY_FULL_CYCLE_DATE_LIMIT,
  );
  const stats: QueryStats = {
    listRequests: 0,
    objectFetches: 0,
    objectsDiscovered: 0,
    objectsParsed: 0,
    bytesFetched: 0,
    cacheHits: 0,
    listBudget: LIST_BUDGET,
    fetchBudget: HISTORY_FETCH_BUDGET,
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
    maxObjectsToFetch: HISTORY_FETCH_BUDGET,
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
