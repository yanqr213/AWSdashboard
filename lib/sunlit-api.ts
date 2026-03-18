const DEFAULT_BASE_URL = "https://api.sunlitsolar.de/rest";
const DEFAULT_ORIGIN = "https://www.sunenergyxt.com";
const DEFAULT_REFERER = "https://www.sunenergyxt.com/";
const DEFAULT_USER_AGENT = "sunlit-web-dashboard/0.1";

type ApiMessage = string | { DE?: string; EN?: string; de?: string; en?: string } | null;

export type SunlitCredentials = {
  accessToken?: string;
  email?: string;
  password?: string;
};

export type SunlitApiContext = SunlitCredentials & {
  baseUrl?: string;
  requiresAuthentication?: boolean;
  familyListMethod?: "GET" | "POST";
  responseMode?: "sunlit" | "mock";
};

type ApiResponse<T> = {
  code: number;
  message?: ApiMessage;
  content: T;
};

export type Family = {
  id: number;
  name: string;
  address?: string | null;
  deviceCount?: number;
  countryCode?: string | null;
};

export type Device = {
  deviceId: number;
  deviceSn?: string | null;
  deviceType?: string | null;
  status?: string;
  fault?: boolean;
  off?: boolean;
  batteryLevel?: number | null;
  inputPowerTotal?: number | null;
  outputPowerTotal?: number | null;
  totalAcPower?: number | null;
  dailyBuyEnergy?: number | null;
  dailyRetEnergy?: number | null;
  totalBuyEnergy?: number | null;
  totalRetEnergy?: number | null;
  today?: {
    currentPower?: number;
    totalPowerGeneration?: number;
    totalEarnings?: {
      earnings?: number;
      currency?: string;
    };
  } | null;
  latestRemoteControl?: RemoteControlRecord | null;
};

export type SpaceIndex = {
  today?: {
    yield?: number;
    earning?: number;
    currency?: string;
    earnings?: {
      earnings?: number;
      currency?: string;
    };
    homePower?: number;
  } | null;
  eleMeter?: {
    deviceStatus?: string;
    fault?: boolean;
    totalAcPower?: number;
    dailyBuyEnergy?: number;
    dailyRetEnergy?: number;
    totalBuyEnergy?: number;
    totalRetEnergy?: number;
  } | null;
  inverter?: {
    deviceStatus?: string;
    fault?: boolean;
    currentPower?: number;
    totalPowerGeneration?: number;
  } | null;
  battery?: {
    deviceStatus?: string;
    fault?: boolean;
    batteryLevel?: number;
    batterySoc?: number;
    inputPower?: number;
    outputPower?: number;
    chargeRemaining?: number;
    dischargeRemaining?: number;
    chargingRemaining?: number;
    dischargingRemaining?: number;
  } | null;
  chargingBox?: {
    deviceStatus?: string;
    fault?: boolean;
  } | null;
  boostSetting?: {
    isOn?: boolean;
    switching?: boolean;
  } | null;
};

export type CurrentStrategy = {
  strategy?: string | null;
  smartStrategyMode?: string | null;
  latestModifiedStatus?: string | null;
  batteryStatus?: string | null;
  deviceStatus?: string | null;
  ratedPower?: number | null;
  maxOutPutPower?: number | null;
  maxAllowedPower?: number | null;
  socMax?: number | null;
  socMin?: number | null;
  hwSocMax?: number | null;
  hwSocMin?: number | null;
  batteryDeviceStatus?: string | null;
  inverterDeviceStatus?: string | null;
  meterDeviceStatus?: string | null;
};

export type SpaceSoc = {
  hwSbmsLimitedDiscSocMin?: number | null;
  hwSbmsLimitedChgSocMax?: number | null;
  batteryBmsDiscSocMin?: number | null;
  batteryBmsChgSocMax?: number | null;
  strategySocMin?: number | null;
  strategySocMax?: number | null;
};

export type StrategyHistoryEntry = {
  modifyDate?: number;
  strategy?: string | null;
  status?: string | null;
  smartStrategyMode?: string | null;
  socMin?: number | null;
  socMax?: number | null;
};

export type RemoteControlRecord = {
  maxOutputPower?: number;
  changeTime?: number;
  status?: "InProgress" | "Success" | "Failed" | string;
  msg?: string;
};

export type DashboardData = {
  families: Family[];
  selectedFamily: Family;
  devices: Device[];
  spaceIndex: SpaceIndex | null;
  currentStrategy: CurrentStrategy | null;
  spaceSoc: SpaceSoc | null;
  strategyHistory: StrategyHistoryEntry[];
};

function getBaseUrl(context?: SunlitApiContext) {
  return context?.baseUrl?.trim() || process.env.SUNLIT_API_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

function getRequestHeaders(token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: DEFAULT_ORIGIN,
    Referer: DEFAULT_REFERER,
    "User-Agent": DEFAULT_USER_AGENT,
    Language: "en",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function normalizeMessage(message: ApiMessage) {
  if (!message) {
    return "Unknown Sunlit API error";
  }

  if (typeof message === "string") {
    return message;
  }

  return message.EN || message.en || message.DE || message.de || "Unknown Sunlit API error";
}

function requireCredential(value: string | undefined, name: string) {
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

export function getConfigurationStatus(baseUrlOverride?: string) {
  const hasToken = Boolean(process.env.SUNLIT_ACCESS_TOKEN?.trim());
  const hasAccount = Boolean(process.env.SUNLIT_EMAIL?.trim() && process.env.SUNLIT_PASSWORD?.trim());

  return {
    baseUrl: baseUrlOverride?.trim() || getBaseUrl(),
    hasToken,
    hasAccount,
    isReady: hasToken || hasAccount,
    defaultFamilyId: process.env.SUNLIT_FAMILY_ID?.trim() || null,
  };
}

const tokenPromiseMap = new Map<string, Promise<string>>();

function getCredentialCacheKey(credentials?: SunlitCredentials) {
  if (credentials?.accessToken?.trim()) {
    return `token:${credentials.accessToken.trim().slice(-12)}`;
  }

  const email = credentials?.email?.trim() || process.env.SUNLIT_EMAIL?.trim();
  return `email:${email || "missing"}`;
}

async function loginWithAccount(credentials?: SunlitCredentials) {
  const email = credentials?.email?.trim() || requireCredential(process.env.SUNLIT_EMAIL, "SUNLIT_EMAIL");
  const password =
    credentials?.password?.trim() || requireCredential(process.env.SUNLIT_PASSWORD, "SUNLIT_PASSWORD");

  const response = await fetch(`${getBaseUrl(credentials)}/user/login`, {
    method: "POST",
    cache: "no-store",
    headers: getRequestHeaders(),
    body: JSON.stringify({
      account: email,
      password,
    }),
  });

  const payload = (await response.json()) as ApiResponse<{
    access_token?: string;
  } | null>;

  if (!response.ok || payload.code !== 0 || !payload.content?.access_token) {
    throw new Error(`Sunlit login failed: ${normalizeMessage(payload.message ?? null)}`);
  }

  return payload.content.access_token;
}

function isMockResponse(context?: SunlitApiContext) {
  return context?.responseMode === "mock" || context?.requiresAuthentication === false;
}

async function resolveAccessToken(context?: SunlitApiContext) {
  if (isMockResponse(context)) {
    return undefined;
  }

  const credentials = context;
  const explicitToken = credentials?.accessToken?.trim() || process.env.SUNLIT_ACCESS_TOKEN?.trim();

  if (explicitToken) {
    return explicitToken;
  }

  const cacheKey = getCredentialCacheKey(credentials);

  if (!tokenPromiseMap.has(cacheKey)) {
    tokenPromiseMap.set(
      cacheKey,
      loginWithAccount(credentials).catch((error) => {
        tokenPromiseMap.delete(cacheKey);
        throw error;
      }),
    );
  }

  const tokenPromise = tokenPromiseMap.get(cacheKey);

  if (!tokenPromise) {
    throw new Error("Unable to initialize Sunlit access token login flow.");
  }

  return tokenPromise;
}

async function requestSunlit<T>(
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
  },
  context?: SunlitApiContext,
) {
  const method = options?.method ?? "GET";
  const token = await resolveAccessToken(context);
  const response = await fetch(`${getBaseUrl(context)}${path}`, {
    method,
    cache: "no-store",
    headers: getRequestHeaders(token),
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (payload?.errmsg) {
      throw new Error(`Sunlit API error: ${payload.errmsg}`);
    }

    throw new Error(
      payload ? `Sunlit API error: ${normalizeMessage(payload.message ?? null)}` : `Sunlit API error: ${response.status}`,
    );
  }

  if (!payload) {
    throw new Error("Sunlit API returned an empty response");
  }

  if (isMockResponse(context)) {
    if (typeof payload === "object" && payload !== null && "errcode" in payload && payload.errcode !== 0) {
      throw new Error(`Mock API error: ${payload.errmsg || payload.errcode}`);
    }

    if (typeof payload === "object" && payload !== null && "content" in payload) {
      return payload.content as T;
    }

    if (typeof payload === "object" && payload !== null && "data" in payload) {
      return payload.data as T;
    }

    return payload as T;
  }

  if (payload.code !== 0) {
    throw new Error(`Sunlit API error: ${normalizeMessage(payload.message ?? null)}`);
  }

  return payload.content;
}

export async function getFamilies(context?: SunlitApiContext) {
  if (context?.familyListMethod === "POST") {
    return requestSunlit<Family[]>("/family/list", {
      method: "POST",
      body: {},
    }, context);
  }

  return requestSunlit<Family[]>("/family/list", undefined, context);
}

export async function getDevices(familyId: number, context?: SunlitApiContext) {
  try {
    const content = await requestSunlit<{
      content?: Device[];
    }>("/v1.2/device/list", {
      method: "POST",
      body: {
        familyId,
        deviceType: "ALL",
      },
    }, context);

    return content.content ?? [];
  } catch {
    const fallback = await requestSunlit<{
      content?: Device[];
    }>("/v1.2/device/list", {
      method: "POST",
      body: {
        familyId,
        deviceType: "",
      },
    }, context);

    return fallback.content ?? [];
  }
}

export async function getSpaceIndex(spaceId: number, context?: SunlitApiContext) {
  return requestSunlit<SpaceIndex>("/v1.5/space/index", {
    method: "POST",
    body: { spaceId },
  }, context);
}

export async function getCurrentStrategy(familyId: number, context?: SunlitApiContext) {
  return requestSunlit<CurrentStrategy>("/v1.1/space/currentStrategy", {
    method: "POST",
    body: { familyId },
  }, context);
}

export async function getSpaceSoc(spaceId: number, context?: SunlitApiContext) {
  return requestSunlit<SpaceSoc>("/v1.1/space/soc", {
    method: "POST",
    body: { spaceId },
  }, context);
}

export async function getStrategyHistory(familyId: number, context?: SunlitApiContext) {
  const content = await requestSunlit<{
    content?: StrategyHistoryEntry[];
  }>("/v1.1/space/strategyHistory", {
    method: "POST",
    body: { familyId },
  }, context);

  return content.content ?? [];
}

export async function setDevicePowerLimit(
  deviceId: number,
  maxOutputPower: number,
  context?: SunlitApiContext,
) {
  await requestSunlit<null>("/v2/remoteControl/power", {
    method: "POST",
    body: {
      deviceId,
      maxOutputPower,
    },
  }, context);
}

export async function getLatestRemoteControlRecord(deviceId: number, context?: SunlitApiContext) {
  return requestSunlit<RemoteControlRecord>("/device/remoteControlRecord/latest", {
    method: "POST",
    body: { deviceId },
  }, context);
}

export function isInverterDevice(device: Device) {
  return device.deviceType === "YUNENG_MICRO_INVERTER" || device.deviceType === "SOLAR_MICRO_INVERTER";
}

export function getDeviceTypeLabel(deviceType?: string | null) {
  switch (deviceType) {
    case "ENERGY_STORAGE_BATTERY":
      return "Battery";
    case "YUNENG_MICRO_INVERTER":
      return "Micro Inverter";
    case "SOLAR_MICRO_INVERTER":
      return "Solar Inverter";
    case "SHELLY_3EM_METER":
      return "Shelly 3EM";
    case "SHELLY_PRO3EM_METER":
      return "Shelly Pro 3EM";
    case undefined:
    case null:
    case "":
      return "Unknown Device";
    default:
      return deviceType;
  }
}

export async function getDashboardData(
  selectedFamilyId?: number,
  context?: SunlitApiContext,
): Promise<DashboardData> {
  const families: Family[] = await getFamilies(context);

  if (families.length === 0) {
    throw new Error("No Sunlit families/spaces were returned for this account.");
  }

  const configuredFamilyId = process.env.SUNLIT_FAMILY_ID ? Number(process.env.SUNLIT_FAMILY_ID) : undefined;
  const targetFamilyId = selectedFamilyId ?? configuredFamilyId ?? families[0]?.id;
  const selectedFamily = families.find((family) => family.id === targetFamilyId) ?? families[0];

  const [devices, spaceIndex, currentStrategy, spaceSoc, strategyHistory]: [
    Device[],
    SpaceIndex | null,
    CurrentStrategy | null,
    SpaceSoc | null,
    StrategyHistoryEntry[],
  ] = await Promise.all([
    getDevices(selectedFamily.id, context),
    getSpaceIndex(selectedFamily.id, context).catch(() => null),
    getCurrentStrategy(selectedFamily.id, context).catch(() => null),
    getSpaceSoc(selectedFamily.id, context).catch(() => null),
    getStrategyHistory(selectedFamily.id, context).catch(() => []),
  ]);

  const enrichedDevices = await Promise.all(
    devices.map(async (device) => {
      if (!isInverterDevice(device)) {
        return device;
      }

      try {
        return {
          ...device,
          latestRemoteControl: await getLatestRemoteControlRecord(device.deviceId, context),
        };
      } catch {
        return {
          ...device,
          latestRemoteControl: null,
        };
      }
    }),
  );

  return {
    families,
    selectedFamily,
    devices: enrichedDevices,
    spaceIndex,
    currentStrategy,
    spaceSoc,
    strategyHistory,
  };
}
