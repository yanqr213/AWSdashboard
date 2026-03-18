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

function createFaultModel(rows) {
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
      bit,
      meaning,
      severity: row[8] || "",
      notes: row[10] || "",
      updatedAt: row[12] || "",
      changeNotes: row[13] || "",
    });
  }

  return faults;
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
  bit: string;
  meaning: string;
  severity: string;
  notes: string;
  updatedAt: string;
  changeNotes: string;
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
  const summarySheet =
    sheets.find((sheet) => sheet.name === "各模块汇总数据草稿") ||
    sheets.find((sheet) => sheet.name === "物模型文档") ||
    sheets[0];
  const faultSheet = sheets.find((sheet) => sheet.name === "故障码定义");

  if (!summarySheet?.path) {
    throw new Error("Expected workbook sheets were not found.");
  }

  const objectModelRows = readSheetRows(entries, summarySheet.path, sharedStrings);
  const faultRows = faultSheet?.path ? readSheetRows(entries, faultSheet.path, sharedStrings) : [];
  const payload = {
    objectModel: createObjectModel(objectModelRows),
    faults: createFaultModel(faultRows),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderOutput(payload), "utf8");

  console.log(
    JSON.stringify(
      {
        inputPath,
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
