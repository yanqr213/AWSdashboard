import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type LocalOtaDraft = {
  id: string;
  createdAt: string;
  environment: string;
  transport: "local-draft" | "s3-publish";
  deviceId: string | null;
  module: string;
  version: string;
  title: string;
  notifyKey: string;
  manifestKey: string;
  fileName: string;
  filePath: string;
  payload: {
    manifest: Record<string, unknown>;
    notify: Record<string, unknown>;
  };
};

const OTA_DRAFT_DIR = path.join(process.cwd(), ".local-data", "ota-notify");

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function ensureDraftDirectory() {
  await mkdir(OTA_DRAFT_DIR, { recursive: true });
}

export async function saveLocalOtaDraft(
  input: Omit<LocalOtaDraft, "fileName" | "filePath">,
) {
  await ensureDraftDirectory();
  const fileName = `${input.createdAt.replace(/[:.]/g, "-")}-${slugify(`${input.environment}-${input.deviceId || "fleet"}-${input.module}-${input.version}`)}.json`;
  const filePath = path.join(OTA_DRAFT_DIR, fileName);
  const draft: LocalOtaDraft = {
    ...input,
    fileName,
    filePath,
  };

  await writeFile(filePath, JSON.stringify(draft, null, 2), "utf8");

  return draft;
}

export async function listLocalOtaDrafts(limit = 12) {
  await ensureDraftDirectory();
  const entries = await readdir(OTA_DRAFT_DIR, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  const drafts = await Promise.all(
    files.map(async (file) => {
      try {
        const filePath = path.join(OTA_DRAFT_DIR, file.name);
        const parsed = JSON.parse(await readFile(filePath, "utf8")) as LocalOtaDraft;
        return {
          ...parsed,
          fileName: parsed.fileName || file.name,
          filePath: parsed.filePath || filePath,
        } satisfies LocalOtaDraft;
      } catch {
        return null;
      }
    }),
  );

  return drafts
    .filter((draft): draft is LocalOtaDraft => draft !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export function getLocalOtaDraftDirectory() {
  return OTA_DRAFT_DIR;
}
