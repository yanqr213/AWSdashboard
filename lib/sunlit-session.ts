import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";

export const SUNLIT_SESSION_COOKIE = "sunlit_session";

export type SunlitSession = {
  email: string;
  password: string;
  savedAt: number;
};

function getSessionSecret() {
  return process.env.SESSION_SECRET?.trim() || "change-me-in-production";
}

function getKey() {
  return createHash("sha256").update(getSessionSecret()).digest();
}

function encryptSession(session: SunlitSession) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptSession(value: string): SunlitSession | null {
  const parts = value.split(".");

  if (parts.length !== 3) {
    return null;
  }

  try {
    const [ivPart, tagPart, encryptedPart] = parts;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getKey(),
      Buffer.from(ivPart, "base64url"),
    );

    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64url")),
      decipher.final(),
    ]);

    const parsed = JSON.parse(decrypted.toString("utf8")) as Partial<SunlitSession>;

    if (!parsed.email || !parsed.password) {
      return null;
    }

    return {
      email: parsed.email,
      password: parsed.password,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function readSunlitSession() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SUNLIT_SESSION_COOKIE)?.value;

  if (!raw) {
    return null;
  }

  return decryptSession(raw);
}

export async function writeSunlitSession(email: string, password: string) {
  const cookieStore = await cookies();
  const value = encryptSession({
    email,
    password,
    savedAt: Date.now(),
  });

  cookieStore.set(SUNLIT_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSunlitSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SUNLIT_SESSION_COOKIE);
}
