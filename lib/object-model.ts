import {
  generatedFaultDefinitions,
  generatedObjectModel,
  type GeneratedFaultDefinition,
  type GeneratedObjectModelField,
} from "@/lib/generated/object-model.generated";

export type ObjectModelField = GeneratedObjectModelField;
export type FaultDefinition = GeneratedFaultDefinition;

function normalizeToken(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

const fieldMap = new Map<string, ObjectModelField>();
const shortCodeMap = new Map<string, ObjectModelField>();

for (const field of generatedObjectModel.fields) {
  fieldMap.set(normalizeToken(field.identifier), field);

  if (field.shortCode) {
    shortCodeMap.set(normalizeToken(field.shortCode), field);
  }
}

export const objectModelFields = [...generatedObjectModel.fields];
export const objectModelModules = [...generatedObjectModel.modules];
export const faultDefinitions = [...generatedFaultDefinitions];

export function normalizeMetricKey(value: string) {
  return normalizeToken(value);
}

export function findFieldByIdentifier(identifier: string) {
  return fieldMap.get(normalizeToken(identifier)) || shortCodeMap.get(normalizeToken(identifier)) || null;
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
  const field = findFieldByIdentifier(identifier);
  return field ? `${field.name} (${field.identifier})` : identifier;
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
