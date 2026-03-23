import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { list, put } from "@vercel/blob";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const AUTH_SESSION_COOKIE = "tb_ops_session";

export type AccountRole = "super-admin" | "user";

export type AuthAccount = {
  id: string;
  email: string;
  passwordHash: string;
  role: AccountRole;
  createdAt: string;
  updatedAt: string;
};

type AuthSession = {
  id: string;
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

type AuthCookieSession = {
  userId: string;
  email: string;
  role: AccountRole;
  expiresAt: string;
};

type AuthStore = {
  users: AuthAccount[];
  sessions: AuthSession[];
};

export type SafeAuthUser = Omit<AuthAccount, "passwordHash">;

const DEFAULT_AUTH_STORE: AuthStore = {
  users: [],
  sessions: [],
};

const AUTH_STORE_PATH = "auth/auth-store.enc";
const LOCAL_AUTH_STORE_FILE =
  process.env.VERCEL === "1" && !process.env.BLOB_READ_WRITE_TOKEN?.trim()
    ? path.join("/tmp", "tb-auth", "auth-store.enc")
    : path.join(process.cwd(), ".local-data", "auth", "auth-store.enc");
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function getAuthStoreSecret() {
  return process.env.AUTH_STORE_SECRET?.trim() || process.env.SESSION_SECRET?.trim() || "change-me-in-production";
}

function getAuthStorageMode() {
  if (process.env.AUTH_STORAGE_MODE?.trim() === "blob" || process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return "blob" as const;
  }

  return "file" as const;
}

function shouldUseSecureCookie() {
  if (process.env.AUTH_COOKIE_SECURE?.trim()) {
    return process.env.AUTH_COOKIE_SECURE.trim() === "1";
  }

  return process.env.VERCEL === "1";
}

function getCipherKey() {
  return createHash("sha256").update(getAuthStoreSecret()).digest();
}

function encryptText(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptText(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const [ivPart, tagPart, encryptedPart] = parts;
    const decipher = createDecipheriv("aes-256-gcm", getCipherKey(), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function toSafeUser(user: AuthAccount): SafeAuthUser {
  const { passwordHash, ...rest } = user;
  return rest;
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, passwordHash: string) {
  const [salt, expectedHash] = passwordHash.split(":");
  if (!salt || !expectedHash) {
    return false;
  }

  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function validatePasswordInput(password: string) {
  if (!password.trim()) {
    return "密码不能为空。";
  }

  if (password.length < 8) {
    return "密码至少 8 位。";
  }

  return null;
}

function encryptCookieSession(session: AuthCookieSession) {
  return encryptText(JSON.stringify(session));
}

function decryptCookieSession(value: string) {
  const decrypted = decryptText(value);
  if (!decrypted) {
    return null;
  }

  try {
    const parsed = JSON.parse(decrypted) as AuthCookieSession;
    if (!parsed.userId || !parsed.email || !parsed.role || !parsed.expiresAt) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function readBlobStoreText() {
  const result = await list({
    prefix: AUTH_STORE_PATH,
    limit: 10,
  });
  const match = result.blobs.find((blob) => blob.pathname === AUTH_STORE_PATH);
  if (!match) {
    return null;
  }

  const response = await fetch(match.url, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }

  return response.text();
}

async function writeBlobStoreText(value: string) {
  await put(AUTH_STORE_PATH, value, {
    access: "public",
    addRandomSuffix: false,
    contentType: "text/plain; charset=utf-8",
  });
}

async function readFileStoreText() {
  try {
    return await readFile(LOCAL_AUTH_STORE_FILE, "utf8");
  } catch {
    return null;
  }
}

async function writeFileStoreText(value: string) {
  await mkdir(path.dirname(LOCAL_AUTH_STORE_FILE), { recursive: true });
  await writeFile(LOCAL_AUTH_STORE_FILE, value, "utf8");
}

async function readStoreFile() {
  const raw =
    getAuthStorageMode() === "blob"
      ? await readBlobStoreText()
      : await readFileStoreText();

  if (!raw) {
    return { ...DEFAULT_AUTH_STORE };
  }

  const decrypted = decryptText(raw);
  if (!decrypted) {
    return { ...DEFAULT_AUTH_STORE };
  }

  try {
    const parsed = JSON.parse(decrypted) as AuthStore;
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return { ...DEFAULT_AUTH_STORE };
  }
}

async function writeStoreFile(store: AuthStore) {
  const encrypted = encryptText(JSON.stringify(store));
  if (getAuthStorageMode() === "blob") {
    await writeBlobStoreText(encrypted);
    return;
  }

  await writeFileStoreText(encrypted);
}

function getSeedAdminEmail() {
  return normalizeEmail(process.env.SEED_ADMIN_EMAIL?.trim() || "qirui.yan@yituishui.cn");
}

function getSeedAdminPassword() {
  return process.env.SEED_ADMIN_PASSWORD?.trim() || "y11531752";
}

function getSeedUserEmail() {
  return normalizeEmail(process.env.SEED_USER_EMAIL?.trim() || "dashboard@yituishui.com");
}

function getSeedUserPassword() {
  return process.env.SEED_USER_PASSWORD?.trim() || "xiaomutech123";
}

function pruneExpiredSessions(store: AuthStore) {
  const now = Date.now();
  return {
    ...store,
    sessions: store.sessions.filter((session) => Date.parse(session.expiresAt) > now),
  };
}

async function ensureSeedAccounts() {
  const store = pruneExpiredSessions(await readStoreFile());
  const seedAccounts = [
    {
      email: getSeedAdminEmail(),
      password: getSeedAdminPassword(),
      role: "super-admin" as const,
    },
    {
      email: getSeedUserEmail(),
      password: getSeedUserPassword(),
      role: "user" as const,
    },
  ];
  let changed = false;

  for (const seedAccount of seedAccounts) {
    if (store.users.some((user) => normalizeEmail(user.email) === seedAccount.email)) {
      continue;
    }

    const now = new Date().toISOString();
    store.users.push({
      id: randomUUID(),
      email: seedAccount.email,
      passwordHash: hashPassword(seedAccount.password),
      role: seedAccount.role,
      createdAt: now,
      updatedAt: now,
    });
    changed = true;
  }

  if (changed) {
    await writeStoreFile(store);
  }

  return store;
}

async function getMutableStore() {
  return ensureSeedAccounts();
}

async function setSessionCookie(user: SafeAuthUser) {
  const cookieStore = await cookies();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  cookieStore.set(AUTH_SESSION_COOKIE, encryptCookieSession({
    userId: user.id,
    email: user.email,
    role: user.role,
    expiresAt,
  }), {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearAuthSession() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_SESSION_COOKIE);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(AUTH_SESSION_COOKIE)?.value;
  if (!cookieValue) {
    return null;
  }

  const session = decryptCookieSession(cookieValue);
  if (!session) {
    return null;
  }

  if (Date.parse(session.expiresAt) <= Date.now()) {
    return null;
  }

  const store = await getMutableStore();
  const user = store.users.find((item) => item.id === session.userId);

  if (user) {
    return toSafeUser(user);
  }

  return {
    id: session.userId,
    email: session.email,
    role: session.role,
    createdAt: session.expiresAt,
    updatedAt: session.expiresAt,
  };
}

export async function requireAuthenticatedUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireSuperAdmin() {
  const user = await requireAuthenticatedUser();
  if (user.role !== "super-admin") {
    redirect("/");
  }

  return user;
}

export async function loginUser(email: string, password: string) {
  const store = await getMutableStore();
  const normalizedEmail = normalizeEmail(email);
  const user = store.users.find((item) => normalizeEmail(item.email) === normalizedEmail);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return {
      ok: false as const,
      error: "账号或密码错误。",
    };
  }

  await writeStoreFile(store);
  await setSessionCookie(toSafeUser(user));

  return {
    ok: true as const,
    user: toSafeUser(user),
  };
}

export async function registerUser(email: string, password: string) {
  return {
    ok: false as const,
    error: "当前平台不支持自助注册，请联系管理员创建账号。",
  };
}

export async function logoutCurrentUser() {
  await clearAuthSession();
}

export async function listAccountsForAdmin() {
  await requireSuperAdmin();
  const store = await getMutableStore();
  return store.users.map(toSafeUser).sort((left, right) => left.email.localeCompare(right.email));
}

export async function createAccountByAdmin(email: string, password: string, role: AccountRole = "user") {
  await requireSuperAdmin();
  const normalizedEmail = normalizeEmail(email);
  const store = await getMutableStore();
  const passwordError = validatePasswordInput(password);

  if (!normalizedEmail || passwordError) {
    return {
      ok: false as const,
      error: !normalizedEmail ? "邮箱不能为空。" : passwordError,
    };
  }

  if (store.users.some((user) => normalizeEmail(user.email) === normalizedEmail)) {
    return {
      ok: false as const,
      error: "该账号已经存在。",
    };
  }

  const now = new Date().toISOString();
  store.users.push({
    id: randomUUID(),
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    role,
    createdAt: now,
    updatedAt: now,
  });
  await writeStoreFile(store);

  return { ok: true as const };
}

export async function updateAccountPasswordByAdmin(userId: string, password: string) {
  await requireSuperAdmin();
  const store = await getMutableStore();
  const user = store.users.find((item) => item.id === userId);
  const passwordError = validatePasswordInput(password);

  if (!user) {
    return { ok: false as const, error: "账号不存在。" };
  }

  if (passwordError) {
    return { ok: false as const, error: passwordError };
  }

  user.passwordHash = hashPassword(password);
  user.updatedAt = new Date().toISOString();
  await writeStoreFile(store);

  return { ok: true as const };
}

export async function updateCurrentUserPassword(currentPassword: string, nextPassword: string) {
  const currentUser = await requireAuthenticatedUser();
  const store = await getMutableStore();
  const user = store.users.find((item) => item.id === currentUser.id);
  const passwordError = validatePasswordInput(nextPassword);

  if (!user) {
    return { ok: false as const, error: "账号不存在。" };
  }

  if (!currentPassword.trim()) {
    return { ok: false as const, error: "当前密码不能为空。" };
  }

  if (passwordError) {
    return { ok: false as const, error: passwordError };
  }

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    return { ok: false as const, error: "当前密码错误。" };
  }

  if (verifyPassword(nextPassword, user.passwordHash)) {
    return { ok: false as const, error: "新密码不能与当前密码相同。" };
  }

  user.passwordHash = hashPassword(nextPassword);
  user.updatedAt = new Date().toISOString();
  await writeStoreFile(store);
  await setSessionCookie(toSafeUser(user));

  return { ok: true as const };
}

export async function deleteAccountByAdmin(userId: string) {
  const admin = await requireSuperAdmin();
  const store = await getMutableStore();
  const target = store.users.find((item) => item.id === userId);

  if (!target) {
    return { ok: false as const, error: "账号不存在。" };
  }

  if (target.role === "super-admin" && target.id === admin.id) {
    return { ok: false as const, error: "不能删除当前登录的超级管理员。" };
  }

  store.users = store.users.filter((item) => item.id !== userId);
  store.sessions = store.sessions.filter((session) => session.userId !== userId);
  await writeStoreFile(store);

  return { ok: true as const };
}
