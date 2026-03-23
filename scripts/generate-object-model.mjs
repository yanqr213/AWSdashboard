import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { XMLParser } from "fast-xml-parser";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const defaultInput = "D:\\download\\物模型_2026_1_6(1).xlsx";
const inputPath = process.argv[2] || process.env.OBJECT_MODEL_XLSX_PATH || defaultInput;
const faultInputPath = process.env.FAULT_CODE_XLSX_PATH || "";
const outputPath =
  process.argv[3] || path.join(workspaceRoot, "lib", "generated", "object-model.generated.ts");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
});

function ensureArray(value) {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function loadZipEntries(xlsxPath) {
  const buffer = fs.readFileSync(xlsxPath);
  const entries = new Map();

  // XLSX is a ZIP archive. This small parser reads the central directory and inflates entries.
  let offset = buffer.length - 22;
  while (offset >= 0 && buffer.readUInt32LE(offset) !== 0x06054b50) {
    offset -= 1;
  }

  if (offset < 0) {
    throw new Error(`Unable to locate ZIP central directory in ${xlsxPath}`);
  }

  const centralDirectorySize = buffer.readUInt32LE(offset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(offset + 16);
  let cursor = centralDirectoryOffset;

  while (cursor < centralDirectoryOffset + centralDirectorySize) {
    const signature = buffer.readUInt32LE(cursor);

    if (signature !== 0x02014b50) {
      throw new Error(`Unexpected ZIP central directory signature at ${cursor}`);
    }

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer
      .subarray(cursor + 46, cursor + 46 + fileNameLength)
      .toString("utf8");

    const localHeaderFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localHeaderExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localHeaderFileNameLength + localHeaderExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    const content =
      compressionMethod === 0
        ? compressed
        : compressionMethod === 8
          ? inflateRawSync(compressed)
          : (() => {
              throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${fileName}`);
            })();

    entries.set(fileName, content);
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readXml(entries, entryPath) {
  const raw = entries.get(entryPath);

  if (!raw) {
    throw new Error(`Missing ${entryPath} in workbook archive`);
  }

  return parser.parse(raw.toString("utf8"));
}

function columnIndex(ref) {
  const columnText = ref.replace(/[0-9]/g, "");
  let total = 0;

  for (const char of columnText) {
    total = total * 26 + (char.charCodeAt(0) - 64);
  }

  return total - 1;
}

function resolveCellText(cell, sharedStrings) {
  if (!cell) {
    return "";
  }

  if (cell.t === "s") {
    const index = Number(cell.v);
    return sharedStrings[index] ?? "";
  }

  if (cell.t === "inlineStr") {
    const value = cell.is?.t ?? cell.is?.r?.map?.((part) => part.t).join("") ?? "";
    return typeof value === "string" ? value : "";
  }

  return cell.v === undefined || cell.v === null ? "" : String(cell.v);
}

function getSharedStrings(entries) {
  if (!entries.has("xl/sharedStrings.xml")) {
    return [];
  }

  const xml = readXml(entries, "xl/sharedStrings.xml");
  return ensureArray(xml.sst?.si).map((item) => {
    if (typeof item?.t === "string") {
      return item.t;
    }

    return ensureArray(item?.r)
      .map((part) => part?.t ?? "")
      .join("");
  });
}

function getSheets(entries) {
  const workbook = readXml(entries, "xl/workbook.xml");
  const rels = readXml(entries, "xl/_rels/workbook.xml.rels");
  const relMap = new Map();

  for (const rel of ensureArray(rels.Relationships?.Relationship)) {
    relMap.set(rel.Id, `xl/${rel.Target}`);
  }

  return ensureArray(workbook.workbook?.sheets?.sheet).map((sheet) => ({
    name: sheet.name,
    path: relMap.get(sheet["r:id"]),
  }));
}

function readSheetRows(entries, sheetPath, sharedStrings) {
  const xml = readXml(entries, sheetPath);
  const rows = ensureArray(xml.worksheet?.sheetData?.row);

  return rows.map((row) => {
    const values = [];

    for (const cell of ensureArray(row.c)) {
      const index = columnIndex(cell.r || "A1");
      values[index] = resolveCellText(cell, sharedStrings).trim();
    }

    return values;
  });
}

function findHeaderRowIndex(rows) {
  return rows.findIndex((row) => {
    const firstCell = row[0]?.trim?.() || "";
    const identifierCell = row[3]?.trim?.() || "";
    return firstCell === "模块" && identifierCell === "标识符";
  });
}

function toNullableNumber(value) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEnumOptions(raw) {
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [value, ...labelParts] = item.split(/[：:]/);
      return {
        value: value.trim(),
        label: labelParts.join(":").trim() || value.trim(),
      };
    });
}

function normalizeIdentifier(identifier) {
  return identifier.replace(/\s+/g, "");
}

function createObjectModel(rows) {
  const headerRowIndex = findHeaderRowIndex(rows);

  if (headerRowIndex < 0) {
    throw new Error("Unable to locate the object-model header row in the workbook.");
  }

  const fields = [];
  const modules = new Map();
  let currentModule = "";

  for (const row of rows.slice(headerRowIndex + 1)) {
    const moduleName = row[0] || currentModule;
    const functionId = row[1];
    const identifier = normalizeIdentifier(row[3] || "");

    if (row[0]) {
      currentModule = row[0];
    }

    if (!moduleName || !functionId || !identifier) {
      continue;
    }

    const field = {
      module: moduleName,
      functionId,
      name: row[2] || identifier,
      identifier,
      shortCode: row[4] || "",
      functionType: row[5] || "",
      access: row[6] || "",
      dataType: row[7] || "",
      description: row[8] || "",
      step: toNullableNumber(row[9]),
      min: toNullableNumber(row[10]),
      max: toNullableNumber(row[11]),
      unit: row[12] || "",
      multiplier: toNullableNumber(row[13]),
      enumOptions: parseEnumOptions(row[14]),
      textLength: toNullableNumber(row[15]),
      reportMode: row[16] || "",
      threshold: toNullableNumber(row[17]),
    };

    fields.push(field);
    modules.set(moduleName, (modules.get(moduleName) || 0) + 1);
  }

  return {
    fields,
    modules: [...modules.entries()].map(([module, count]) => ({
      module,
      count,
    })),
  };
}

function mergeObjectModelField(primaryField, fallbackField) {
  return {
    module: primaryField.module || fallbackField.module,
    functionId: primaryField.functionId || fallbackField.functionId,
    name: primaryField.name || fallbackField.name,
    identifier: primaryField.identifier || fallbackField.identifier,
    shortCode: primaryField.shortCode || fallbackField.shortCode,
    functionType: primaryField.functionType || fallbackField.functionType,
    access: primaryField.access || fallbackField.access,
    dataType: primaryField.dataType || fallbackField.dataType,
    description: primaryField.description || fallbackField.description,
    step: primaryField.step ?? fallbackField.step,
    min: primaryField.min ?? fallbackField.min,
    max: primaryField.max ?? fallbackField.max,
    unit: primaryField.unit || fallbackField.unit,
    multiplier: primaryField.multiplier ?? fallbackField.multiplier,
    enumOptions: primaryField.enumOptions.length ? primaryField.enumOptions : fallbackField.enumOptions,
    textLength: primaryField.textLength ?? fallbackField.textLength,
    reportMode: primaryField.reportMode || fallbackField.reportMode,
    threshold: primaryField.threshold ?? fallbackField.threshold,
  };
}

function mergeObjectModels(models) {
  const fieldsByIdentifier = new Map();

  for (const model of models) {
    for (const field of model.fields) {
      const existing = fieldsByIdentifier.get(field.identifier);
      fieldsByIdentifier.set(field.identifier, existing ? mergeObjectModelField(existing, field) : field);
    }
  }

  const mergedFields = [...fieldsByIdentifier.values()].sort((left, right) => {
    return left.module.localeCompare(right.module) || Number(left.functionId) - Number(right.functionId);
  });
  const modules = new Map();

  for (const field of mergedFields) {
    modules.set(field.module, (modules.get(field.module) || 0) + 1);
  }

  return {
    fields: mergedFields,
    modules: [...modules.entries()].map(([module, count]) => ({
      module,
      count,
    })),
  };
}

function createLegacyFaultModel(rows) {
  if (!rows.length) {
    return [];
  }

  const faults = [];
  let currentGroup = "";

  for (const row of rows.slice(1)) {
    if (row[0]) {
      currentGroup = row[0];
    }

    const bit = row[2] || "";
    const meaning = row[3] || "";

    if (!currentGroup || !bit || !meaning) {
      continue;
    }

    faults.push({
      group: currentGroup,
      groupBit: toNullableNumber(bit),
      identifier: "",
      identifierBit: null,
      meaning,
      severity: row[8] || "",
      code: "",
      display: "",
      category: "",
      name: "",
      description: row[10] || "",
      nameEn: "",
    });
  }

  return faults;
}

function createEnhancedFaultModel(rows) {
  if (rows.length <= 1) {
    return [];
  }

  const faults = [];
  let currentGroup = "";

  for (const row of rows.slice(1)) {
    if (row[0]) {
      currentGroup = row[0];
    }

    const group = row[0] || currentGroup;
    const groupBit = toNullableNumber(row[1]);
    const identifier = normalizeIdentifier(row[2] || "");
    const identifierBit = toNullableNumber(row[3]);
    const meaning = row[4] || "";

    if (!group || groupBit === null || !identifier || identifierBit === null || !meaning) {
      continue;
    }

    faults.push({
      group,
      groupBit,
      identifier,
      identifierBit,
      meaning,
      severity: row[5] || "",
      code: row[6] || "",
      display: row[7] || "",
      category: row[8] || "",
      name: row[9] || "",
      description: row[10] || "",
      nameEn: row[11] || "",
    });
  }

  return faults;
}

function createFaultModel(rows) {
  const header = rows[0] || [];
  const hasEnhancedColumns = header.includes("物模型标识") && header.includes("物模型故障位");
  return hasEnhancedColumns ? createEnhancedFaultModel(rows) : createLegacyFaultModel(rows);
}

function renderOutput(payload) {
  const toAsciiJson = (value) =>
    JSON.stringify(value, null, 2).replace(/[\u007f-\uffff]/g, (char) =>
      `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );

  return `/* eslint-disable */
// Generated by scripts/generate-object-model.mjs from the configured workbook source

export type GeneratedObjectModelField = {
  module: string;
  functionId: string;
  name: string;
  identifier: string;
  shortCode: string;
  functionType: string;
  access: string;
  dataType: string;
  description: string;
  step: number | null;
  min: number | null;
  max: number | null;
  unit: string;
  multiplier: number | null;
  enumOptions: Array<{ value: string; label: string }>;
  textLength: number | null;
  reportMode: string;
  threshold: number | null;
};

export type GeneratedFaultDefinition = {
  group: string;
  groupBit: number | null;
  identifier: string;
  identifierBit: number | null;
  meaning: string;
  severity: string;
  code: string;
  display: string;
  category: string;
  name: string;
  description: string;
  nameEn: string;
};

export const generatedObjectModel = ${toAsciiJson(payload.objectModel)} as const satisfies {
  fields: readonly GeneratedObjectModelField[];
  modules: readonly { module: string; count: number }[];
};

export const generatedFaultDefinitions = ${toAsciiJson(payload.faults)} as const satisfies readonly GeneratedFaultDefinition[];
`;
}

function main() {
  const entries = loadZipEntries(inputPath);
  const sharedStrings = getSharedStrings(entries);
  const sheets = getSheets(entries);
  const objectModelSheets = [
    sheets.find((sheet) => sheet.name === "各模块汇总数据草稿"),
    sheets.find((sheet) => sheet.name === "物模型文档"),
  ].filter((sheet, index, allSheets) => Boolean(sheet?.path) && allSheets.findIndex((item) => item?.path === sheet?.path) === index);
  const summarySheet = objectModelSheets[0] || sheets[0];
  const faultSheet = sheets.find((sheet) => sheet.name === "故障码定义");

  if (!summarySheet?.path) {
    throw new Error("Expected workbook sheets were not found.");
  }

  const objectModelModels = (objectModelSheets.length ? objectModelSheets : [summarySheet]).map((sheet) =>
    createObjectModel(readSheetRows(entries, sheet.path, sharedStrings)),
  );
  const faultRows = faultInputPath
    ? (() => {
        const faultEntries = loadZipEntries(faultInputPath);
        const faultSharedStrings = getSharedStrings(faultEntries);
        const faultSheets = getSheets(faultEntries);
        const firstSheet = faultSheets[0];
        return firstSheet?.path ? readSheetRows(faultEntries, firstSheet.path, faultSharedStrings) : [];
      })()
    : faultSheet?.path
      ? readSheetRows(entries, faultSheet.path, sharedStrings)
      : [];
  const payload = {
    objectModel: mergeObjectModels(objectModelModels),
    faults: createFaultModel(faultRows),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderOutput(payload), "utf8");

  console.log(
    JSON.stringify(
      {
        inputPath,
        faultInputPath: faultInputPath || null,
        outputPath,
        fields: payload.objectModel.fields.length,
        modules: payload.objectModel.modules.length,
        faults: payload.faults.length,
      },
      null,
      2,
    ),
  );
}

main();
