#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const objectModelPath = path.join(repoRoot, "lib/generated/object-model.generated.ts");

function parseArgs(argv) {
  const options = {
    environment: "hk-test",
    deviceId: "",
    startDate: "",
    endDate: "",
    output: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--environment" && next) {
      options.environment = next;
      index += 1;
      continue;
    }

    if (token === "--device" && next) {
      options.deviceId = next;
      index += 1;
      continue;
    }

    if (token === "--start-date" && next) {
      options.startDate = next;
      index += 1;
      continue;
    }

    if (token === "--end-date" && next) {
      options.endDate = next;
      index += 1;
      continue;
    }

    if (token === "--output" && next) {
      options.output = next;
      index += 1;
      continue;
    }
  }

  if (!options.deviceId || !options.startDate || !options.endDate) {
    throw new Error("Usage: node scripts/export-device-s3-csv.mjs --device <deviceId> --start-date YYYY-MM-DD --end-date YYYY-MM-DD [--environment hk-test|de-prod] [--output /abs/path.csv]");
  }

  return options;
}

function normalizeToken(value) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function extractGeneratedJson(text, exportName, nextExportName = null) {
  const startToken = `export const ${exportName} = `;
  const startIndex = text.indexOf(startToken);
  if (startIndex === -1) {
    throw new Error(`Could not find ${exportName} in generated object model file.`);
  }

  let contentStart = startIndex + startToken.length;
  while (/\s/.test(text[contentStart] || "")) {
    contentStart += 1;
  }

  const opening = text[contentStart];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : null;
  if (!closing) {
    throw new Error(`Unsupported JSON opening token for ${exportName}.`);
  }

  let depth = 0;
  let inString = false;
  let escaping = false;
  let contentEnd = -1;

  for (let index = contentStart; index < text.length; index += 1) {
    const character = text[index];

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

    if (character === opening) {
      depth += 1;
      continue;
    }

    if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        contentEnd = index + 1;
        break;
      }
    }
  }

  if (contentEnd === -1) {
    throw new Error(`Could not determine end of ${exportName} export.`);
  }

  const rawJson = text.slice(contentStart, contentEnd);
  if (nextExportName && !text.includes(`export const ${nextExportName}`, contentEnd)) {
    throw new Error(`Could not find ${nextExportName} after ${exportName}.`);
  }

  return JSON.parse(rawJson);
}

function loadObjectModelFields() {
  const source = fs.readFileSync(objectModelPath, "utf8");
  const generated = extractGeneratedJson(source, "generatedObjectModel", "generatedFaultDefinitions");
  return generated.fields || [];
}

function buildFieldIndexes(fields) {
  const fieldMap = new Map();
  const shortCodeMap = new Map();

  for (const field of fields) {
    fieldMap.set(normalizeToken(field.identifier), field);
    if (field.shortCode) {
      shortCodeMap.set(normalizeToken(field.shortCode), field);
    }
  }

  return { fieldMap, shortCodeMap };
}

function resolveMetricField(rawIdentifier, fieldMap, shortCodeMap) {
  const trimmed = String(rawIdentifier || "").trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeToken(trimmed);
  const direct = fieldMap.get(normalized) || shortCodeMap.get(normalized);
  if (direct) {
    return {
      field: direct,
      identifier: direct.identifier,
      canonicalIdentifier: direct.identifier,
      shortCode: direct.shortCode || direct.identifier,
      displayLabel: direct.name,
      sourceIdentifier: trimmed,
      instanceIndex: null,
    };
  }

  const indexedMatch = trimmed.match(/^(.*?)(\d+)$/);
  if (!indexedMatch) {
    return null;
  }

  const [, prefix, suffix] = indexedMatch;
  const indexedField = fieldMap.get(normalizeToken(`${prefix}i`)) || shortCodeMap.get(normalizeToken(`${prefix}i`));
  if (!indexedField) {
    return null;
  }

  const instanceIndex = Number(suffix);
  const packageLabel = Number.isFinite(instanceIndex) ? ` (包${instanceIndex + 1})` : "";

  return {
    field: indexedField,
    identifier: trimmed,
    canonicalIdentifier: indexedField.identifier,
    shortCode: trimmed,
    displayLabel: `${indexedField.name}${packageLabel}`,
    sourceIdentifier: trimmed,
    instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
  };
}

function shouldScaleNumericField(field) {
  return !["BOOL", "ENUM", "TEXT"].includes(field.dataType);
}

function getFieldScaleOverride(field) {
  if (
    /温度/.test(field.name) &&
    !/序号/.test(field.name) &&
    (field.step === null || field.step <= 0) &&
    (field.multiplier === null || field.multiplier === 1)
  ) {
    return 0.1;
  }

  return null;
}

function getFieldScaleFactor(field) {
  if (!shouldScaleNumericField(field)) {
    return 1;
  }

  const overrideScale = getFieldScaleOverride(field);
  if (overrideScale !== null) {
    return overrideScale;
  }

  if (typeof field.step === "number" && Number.isFinite(field.step) && field.step > 0) {
    return field.step;
  }

  if (typeof field.multiplier === "number" && Number.isFinite(field.multiplier) && field.multiplier > 0) {
    return field.multiplier;
  }

  return 1;
}

function countFractionDigits(value) {
  if (!Number.isFinite(value) || value <= 0 || Math.trunc(value) === value) {
    return 0;
  }

  const asText = value.toString().toLowerCase();
  if (asText.includes("e-")) {
    const [, exponent = "0"] = asText.split("e-");
    return Number(exponent) || 0;
  }

  const [, fraction = ""] = asText.split(".");
  return fraction.length;
}

function getFieldFractionDigits(field) {
  if (!shouldScaleNumericField(field)) {
    return 0;
  }

  if (typeof field.step === "number" && Number.isFinite(field.step) && field.step > 0 && field.step < 1) {
    return countFractionDigits(field.step);
  }

  const scaleFactor = getFieldScaleFactor(field);
  return scaleFactor < 1 ? countFractionDigits(scaleFactor) : 0;
}

function getFieldDisplayUnit(field) {
  const rawUnit = String(field.unit || "").trim();
  if (rawUnit) {
    return rawUnit
      .replace(/^0\.\d+\s*/i, "")
      .replace(/^1\s*/i, "")
      .replace(/^kwh$/i, "kWh")
      .replace(/^mv$/i, "mV")
      .replace(/^w·h$/i, "Wh");
  }

  if (/温度/.test(field.name) && !/序号/.test(field.name)) {
    return "℃";
  }

  if (field.name.includes("视在功率")) {
    return "VA";
  }

  if (field.name.includes("功率") && !field.name.includes("功率类型")) {
    return "W";
  }

  if (field.name.includes("电流")) {
    return "A";
  }

  return "";
}

function scaleFieldNumericValue(field, value) {
  const scaledValue = value * getFieldScaleFactor(field);
  const digits = getFieldFractionDigits(field);

  if (digits <= 0) {
    return scaledValue;
  }

  const precision = 10 ** digits;
  return Math.round((scaledValue + Number.EPSILON) * precision) / precision;
}

function formatScaledFieldNumericValue(field, value) {
  const digits = getFieldFractionDigits(field);
  const formatted = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
  const unit = getFieldDisplayUnit(field);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatMetricValue(field, rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return "";
  }

  if (typeof rawValue === "boolean") {
    return rawValue ? "true" : "false";
  }

  if (field.dataType === "ENUM" && typeof rawValue === "number" && Array.isArray(field.enumOptions) && field.enumOptions.length) {
    const match = field.enumOptions.find((option) => option.value === String(rawValue));
    return match ? `${match.label} (${rawValue})` : String(rawValue);
  }

  if (typeof rawValue === "number") {
    return formatScaledFieldNumericValue(field, scaleFieldNumericValue(field, rawValue));
  }

  return String(rawValue);
}

function coerceScalar(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function parseTimestampLike(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) {
      return value;
    }

    if (value > 1_000_000_000) {
      return value * 1000;
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d+$/.test(trimmed)) {
      return parseTimestampLike(Number(trimmed));
    }

    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function splitConcatenatedJson(text) {
  const chunks = [];
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

function parseJsonLike(text) {
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

    return null;
  }
}

function decodeBase64JsonText(value) {
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function extractReportedRecords(input, depth = 0) {
  if (depth > 5) {
    return [];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item) => extractReportedRecords(item, depth + 1));
  }

  if (!input || typeof input !== "object") {
    return [];
  }

  const record = input;
  const units = [];

  if (record.state && typeof record.state === "object" && record.state.reported && typeof record.state.reported === "object") {
    units.push(record.state.reported);
  } else if (record.reported && typeof record.reported === "object") {
    units.push(record.reported);
  } else {
    const hasDirectMetricKeys = Object.keys(record).some((key) => typeof record[key] !== "object" && key !== "rawData");
    if (hasDirectMetricKeys) {
      units.push(record);
    }
  }

  const rawData = typeof record.rawData === "string" ? decodeBase64JsonText(record.rawData) : null;

  if (rawData) {
    const parsedRawData = parseJsonLike(rawData);
    if (parsedRawData) {
      units.unshift(...extractReportedRecords(parsedRawData, depth + 1));
    }
  }

  if (units.length) {
    return units;
  }

  return Object.values(record).flatMap((value) => extractReportedRecords(value, depth + 1));
}

const TIMESTAMP_KEYS = ["timestamp", "ts", "time", "reportTime", "createTime", "updatedAt", "lastUpdatedAt"];

function collectRows(record, context, rows) {
  const recordTimestamp =
    TIMESTAMP_KEYS.map((key) => parseTimestampLike(record[key])).find((value) => value !== null) ||
    context.fallbackTimestamp;

  for (const [key, rawValue] of Object.entries(record)) {
    const value = coerceScalar(rawValue);
    if (value === undefined) {
      continue;
    }

    const resolved = resolveMetricField(key, context.fieldMap, context.shortCodeMap);
    if (!resolved) {
      continue;
    }

    const scaledValue = typeof value === "number" ? scaleFieldNumericValue(resolved.field, value) : "";
    rows.push({
      device_id: context.deviceId,
      selected_environment: context.environment,
      s3_bucket: context.bucket,
      s3_key: context.sourceKey,
      payload_source: context.payloadSource,
      reported_at_ms: recordTimestamp,
      reported_at_berlin: new Date(recordTimestamp).toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).replace(" ", "T"),
      source_identifier: resolved.sourceIdentifier,
      identifier: resolved.identifier,
      canonical_identifier: resolved.canonicalIdentifier,
      field_name_cn: resolved.displayLabel,
      short_code: resolved.shortCode,
      module: resolved.field.module,
      function_id: resolved.field.functionId,
      data_type: resolved.field.dataType,
      unit: getFieldDisplayUnit(resolved.field),
      raw_value: value,
      scaled_value: scaledValue,
      display_value: formatMetricValue(resolved.field, value),
      description: resolved.field.description || "",
      report_mode: resolved.field.reportMode || "",
      instance_index: resolved.instanceIndex ?? "",
    });
  }
}

function enumerateDays(startDate, endDate) {
  const days = [];
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (current <= end) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return days;
}

async function listObjects(client, bucket, prefix) {
  const objects = [];
  let continuationToken = undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    objects.push(...(response.Contents || []));
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

function toCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = typeof value === "string" ? value : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }

  return text;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fields = loadObjectModelFields();
  const { fieldMap, shortCodeMap } = buildFieldIndexes(fields);

  const region =
    options.environment === "de-prod"
      ? process.env.AWS_IOT_PROD_REGION?.trim() || "eu-central-1"
      : process.env.AWS_IOT_TEST_REGION?.trim() || "ap-east-1";
  const bucket =
    options.environment === "de-prod"
      ? (process.env.AWS_IOT_PROD_BUCKETS?.split(",")[0] || "tuobang-iot-data-report-prod").trim()
      : (process.env.AWS_IOT_TEST_BUCKETS?.split(",")[0] || "tuobang-iot-data-report-dev").trim();

  const client = new S3Client({ region });
  const days = enumerateDays(options.startDate, options.endDate);
  const rows = [];

  for (const day of days) {
    const prefix = `iot-data/${day}/${options.deviceId}/`;
    const objects = await listObjects(client, bucket, prefix);

    for (const object of objects) {
      if (!object.Key) {
        continue;
      }

      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: object.Key,
        }),
      );
      const text = await response.Body?.transformToString();
      if (!text) {
        continue;
      }

      const parsed = parseJsonLike(text);
      if (!parsed) {
        continue;
      }

      const fallbackTimestamp = object.LastModified?.getTime() || Date.now();
      const records = extractReportedRecords(parsed);

      for (const record of records) {
        collectRows(record, {
          environment: options.environment,
          deviceId: options.deviceId,
          bucket,
          sourceKey: object.Key,
          payloadSource: "reported",
          fallbackTimestamp,
          fieldMap,
          shortCodeMap,
        }, rows);
      }
    }
  }

  const dedupedRows = [];
  const seen = new Set();

  for (const row of rows) {
    const dedupeKey = [
      row.s3_key,
      row.payload_source,
      row.reported_at_ms,
      row.source_identifier,
      row.raw_value,
    ].join("|");

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    dedupedRows.push(row);
  }

  dedupedRows.sort((left, right) => {
    if (left.reported_at_ms !== right.reported_at_ms) {
      return left.reported_at_ms - right.reported_at_ms;
    }

    if (left.s3_key !== right.s3_key) {
      return left.s3_key.localeCompare(right.s3_key);
    }

    return left.source_identifier.localeCompare(right.source_identifier);
  });

  const outputPath =
    options.output ||
    path.join(
      repoRoot,
      "reports",
      `${options.deviceId}-${options.startDate.replaceAll("-", "")}-${options.endDate.replaceAll("-", "")}-s3-long.csv`,
    );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const headers = [
    "device_id",
    "selected_environment",
    "s3_bucket",
    "s3_key",
    "payload_source",
    "reported_at_ms",
    "reported_at_berlin",
    "source_identifier",
    "identifier",
    "canonical_identifier",
    "field_name_cn",
    "short_code",
    "module",
    "function_id",
    "data_type",
    "unit",
    "raw_value",
    "scaled_value",
    "display_value",
    "description",
    "report_mode",
    "instance_index",
  ];

  const lines = [
    headers.join(","),
    ...dedupedRows.map((row) => headers.map((header) => toCsvValue(row[header])).join(",")),
  ];

  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    deviceId: options.deviceId,
    environment: options.environment,
    startDate: options.startDate,
    endDate: options.endDate,
    bucket,
    rowCount: dedupedRows.length,
    outputPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
