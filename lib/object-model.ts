import {
  generatedFaultDefinitions,
  generatedObjectModel,
  type GeneratedFaultDefinition,
  type GeneratedObjectModelField,
} from "@/lib/generated/object-model.generated";

export type ObjectModelField = GeneratedObjectModelField;
export type FaultDefinition = GeneratedFaultDefinition;
export type ResolvedMetricField = {
  field: ObjectModelField;
  identifier: string;
  canonicalIdentifier: string;
  shortCode: string;
  label: string;
  instanceIndex: number | null;
  sourceIdentifier: string;
};

const FIELD_UNIT_OVERRIDES = new Map<string, string>([
  ["soc", "%"],
  ["soh", "%"],
  ["socmin", "%"],
  ["socmax", "%"],
  ["socmindiff", "%"],
  ["socmaxdiff", "%"],
  ["offsocmin", "%"],
  ["soci", "%"],
  ["sohi", "%"],
  ["chgti", "h"],
  ["dsgti", "h"],
  ["grids", "VA"],
  ["avecellvi", "mV"],
  ["bmsvi", "V"],
  ["hfpi", "W"],
  ["pb", "W"],
  ["batchgmaxp", "W"],
  ["gridchgmaxp", "W"],
]);

function normalizeToken(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

const fieldMap = new Map<string, ObjectModelField>();
const shortCodeMap = new Map<string, ObjectModelField>();
const aliasMatchesMap = new Map<string, ObjectModelField[]>();

for (const field of generatedObjectModel.fields) {
  fieldMap.set(normalizeToken(field.identifier), field);
  aliasMatchesMap.set(normalizeToken(field.identifier), [...(aliasMatchesMap.get(normalizeToken(field.identifier)) || []), field]);

  if (field.shortCode) {
    shortCodeMap.set(normalizeToken(field.shortCode), field);
    aliasMatchesMap.set(normalizeToken(field.shortCode), [...(aliasMatchesMap.get(normalizeToken(field.shortCode)) || []), field]);
  }
}

export const objectModelFields = [...generatedObjectModel.fields];
export const objectModelModules = [...generatedObjectModel.modules];
export const faultDefinitions = [...generatedFaultDefinitions];

export function normalizeMetricKey(value: string) {
  return normalizeToken(value);
}

function findDirectField(identifier: string) {
  return fieldMap.get(normalizeToken(identifier)) || shortCodeMap.get(normalizeToken(identifier)) || null;
}

export function resolveMetricField(identifier: string): ResolvedMetricField | null {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return null;
  }

  const directField = findDirectField(trimmed);
  if (directField) {
    return {
      field: directField,
      identifier: directField.identifier,
      canonicalIdentifier: directField.identifier,
      shortCode: directField.shortCode || directField.identifier,
      label: directField.name,
      instanceIndex: null,
      sourceIdentifier: trimmed,
    };
  }

  const indexedMatch = trimmed.match(/^(.*?)(\d+)$/);
  if (!indexedMatch) {
    return null;
  }

  const [, prefix, suffix] = indexedMatch;
  const indexedField = findDirectField(`${prefix}i`);
  if (!indexedField) {
    return null;
  }

  const instanceIndex = Number(suffix);
  const packageSuffix = Number.isFinite(instanceIndex) ? ` (包${instanceIndex + 1})` : "";

  return {
    field: indexedField,
    identifier: trimmed,
    canonicalIdentifier: indexedField.identifier,
    shortCode: trimmed,
    label: `${indexedField.name}${packageSuffix}`,
    instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
    sourceIdentifier: trimmed,
  };
}

export function findFieldByIdentifier(identifier: string) {
  return resolveMetricField(identifier)?.field || null;
}

export function findFieldsByIdentifier(identifier: string) {
  return [...(aliasMatchesMap.get(normalizeToken(identifier)) || [])];
}

function shouldScaleNumericField(field: ObjectModelField) {
  return !["BOOL", "ENUM", "TEXT"].includes(field.dataType);
}

function getFieldScaleOverride(field: ObjectModelField) {
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

export function getFieldScaleFactor(field: ObjectModelField) {
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

function countFractionDigits(value: number) {
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

export function getFieldFractionDigits(field: ObjectModelField) {
  if (!shouldScaleNumericField(field)) {
    return 0;
  }

  if (typeof field.step === "number" && Number.isFinite(field.step) && field.step > 0 && field.step < 1) {
    return countFractionDigits(field.step);
  }

  const scaleFactor = getFieldScaleFactor(field);
  return scaleFactor < 1 ? countFractionDigits(scaleFactor) : 0;
}

export function getFieldDisplayUnit(field: ObjectModelField) {
  const normalizedIdentifier = normalizeMetricKey(field.identifier);
  const overrideUnit = FIELD_UNIT_OVERRIDES.get(normalizedIdentifier);
  if (overrideUnit) {
    return overrideUnit;
  }

  const rawUnit = field.unit.trim();
  if (rawUnit) {
    return rawUnit
      .replace(/^0\.\d+\s*/i, "")
      .replace(/^1\s*/i, "")
      .replace(/^kwh$/i, "kWh")
      .replace(/^mv$/i, "mV")
      .replace(/^w·h$/i, "Wh");
  }

  if (["BOOL", "ENUM", "TEXT"].includes(field.dataType)) {
    return "";
  }

  if (/温度/.test(field.name) && !/序号/.test(field.name)) {
    return "℃";
  }

  if (/频率/.test(field.name)) {
    return "Hz";
  }

  if (/单体电压|电芯电压/.test(field.name)) {
    return "mV";
  }

  if (/电压|总压/.test(field.name)) {
    return "V";
  }

  if (field.name.includes("视在功率")) {
    return "VA";
  }

  if (
    field.name.includes("功率") &&
    !field.name.includes("功率类型") &&
    !field.name.includes("功率因数") &&
    !field.name.includes("开启/停止控制")
  ) {
    return "W";
  }

  if (field.name.includes("电流")) {
    return "A";
  }

  if (/电量/.test(field.name)) {
    return "Wh";
  }

  if (/能量/.test(field.name)) {
    return "kWh";
  }

  return "";
}

export function scaleFieldNumericValue(field: ObjectModelField, value: number) {
  const scaledValue = value * getFieldScaleFactor(field);
  const digits = getFieldFractionDigits(field);

  if (digits <= 0) {
    return scaledValue;
  }

  const precision = 10 ** digits;
  return Math.round((scaledValue + Number.EPSILON) * precision) / precision;
}

export function formatScaledFieldNumericValue(field: ObjectModelField, value: number) {
  const digits = getFieldFractionDigits(field);
  const formatted = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
  const unit = getFieldDisplayUnit(field);
  return unit ? `${formatted} ${unit}` : formatted;
}

export function getPreferredMetricIdentifiers() {
  const preferred = [
    "TotalOutP",
    "TotalInP",
    "GridP",
    "BatP",
    "SOC",
    "SOH",
    "PVTotalP",
    "PV1P",
    "PV2P",
    "PV3P",
    "PV4P",
    "LoadP",
    "EnvT",
    "WIFIRSSI",
  ];

  return preferred.filter((identifier) => findFieldByIdentifier(identifier));
}

export function getFieldDisplayName(identifier: string) {
  const resolved = resolveMetricField(identifier);
  if (!resolved) {
    return identifier;
  }

  const tag = resolved.identifier === resolved.canonicalIdentifier ? resolved.canonicalIdentifier : `${resolved.identifier} / ${resolved.canonicalIdentifier}`;
  return `${resolved.label} (${tag})`;
}

export function groupFieldsByModule(fields: ObjectModelField[]) {
  const grouped = new Map<string, ObjectModelField[]>();

  for (const field of fields) {
    const bucket = grouped.get(field.module) || [];
    bucket.push(field);
    grouped.set(field.module, bucket);
  }

  return [...grouped.entries()].map(([module, moduleFields]) => ({
    module,
    fields: moduleFields,
  }));
}
