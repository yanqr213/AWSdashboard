import { NextResponse } from "next/server";

import { readSunlitSession } from "@/lib/sunlit-session";
import { getDashboardData, isInverterDevice, type SunlitCredentials } from "@/lib/sunlit-api";
import type { SolarForecastPoint } from "@/lib/automation-studio";

export const dynamic = "force-dynamic";

const BERLIN_TIMEZONE = "Europe/Berlin";

type DwdWarning = {
  state?: string;
  regionName?: string;
  event?: string;
  level?: number;
  start?: number;
  end?: number;
};

function formatBerlinTime(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "00";

  return {
    iso: `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`,
    display: `${part("day")}.${part("month")}.${part("year")} ${part("hour")}:${part("minute")}:${part("second")}`,
    dateKey: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    timezone: BERLIN_TIMEZONE,
  };
}

async function getWeatherSnapshot() {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=precipitation_probability&timezone=Europe%2FBerlin&forecast_days=1";
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`weather_${response.status}`);
  }

  const payload = await response.json();

  return {
    location: "Berlin, DE",
    temperatureC: payload.current?.temperature_2m ?? null,
    apparentTemperatureC: payload.current?.apparent_temperature ?? null,
    precipitationMm: payload.current?.precipitation ?? null,
    windSpeedKph: payload.current?.wind_speed_10m ?? null,
    weatherCode: payload.current?.weather_code ?? null,
    precipitationProbability:
      Array.isArray(payload.hourly?.precipitation_probability) && payload.hourly.precipitation_probability.length > 0
        ? payload.hourly.precipitation_probability[0]
        : null,
  };
}

async function getGermanPriceSnapshot() {
  const response = await fetch("https://api.awattar.de/v1/marketdata", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`price_${response.status}`);
  }

  const payload = await response.json();
  const entries = Array.isArray(payload.data) ? payload.data : [];
  const now = Date.now();
  const current =
    entries.find((entry: { start_timestamp: number; end_timestamp: number }) => entry.start_timestamp <= now && entry.end_timestamp > now) ||
    entries[0] ||
    null;
  const sorted = [...entries].sort(
    (left: { marketprice: number }, right: { marketprice: number }) => left.marketprice - right.marketprice,
  );
  const average =
    entries.length > 0
      ? entries.reduce((sum: number, entry: { marketprice: number }) => sum + entry.marketprice, 0) / entries.length
      : null;
  const toCtPerKwh = (value: number | null | undefined) =>
    typeof value === "number" ? Number((value / 10).toFixed(2)) : null;

  return {
    currency: "EUR",
    unit: "ct/kWh",
    currentCtPerKwh: toCtPerKwh(current?.marketprice),
    currentWindow: current
      ? {
          start: current.start_timestamp,
          end: current.end_timestamp,
        }
      : null,
    cheapestCtPerKwh: toCtPerKwh(sorted[0]?.marketprice),
    cheapestWindow: sorted[0]
      ? {
          start: sorted[0].start_timestamp,
          end: sorted[0].end_timestamp,
        }
      : null,
    highestCtPerKwh: toCtPerKwh(sorted[sorted.length - 1]?.marketprice),
    averageCtPerKwh: toCtPerKwh(average),
  };
}

async function getDwdWarningsSnapshot() {
  const response = await fetch("https://www.dwd.de/DWD/warnungen/warnapp/json/warnings.json", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`warnings_${response.status}`);
  }

  const text = await response.text();
  const jsonText = text.replace(/^warnWetter\.loadWarnings\(/, "").replace(/\);?\s*$/, "");
  const payload = JSON.parse(jsonText);
  const warnings = Object.values(payload.warnings || {}).flat() as DwdWarning[];
  const berlinWarnings = warnings.filter((warning) => warning.state === "Berlin");
  const highestGermany = warnings.reduce<DwdWarning | null>(
    (best, current) => (!best || (current.level || 0) > (best.level || 0) ? current : best),
    null,
  );
  const highestBerlin = berlinWarnings.reduce<DwdWarning | null>(
    (best, current) => (!best || (current.level || 0) > (best.level || 0) ? current : best),
    null,
  );

  return {
    totalWarnings: warnings.length,
    berlinCount: berlinWarnings.length,
    highestGermany: highestGermany
      ? {
          state: highestGermany.state || "Germany",
          regionName: highestGermany.regionName || "Unknown region",
          event: highestGermany.event || "Unknown event",
          level: highestGermany.level || 0,
          start: highestGermany.start || null,
          end: highestGermany.end || null,
        }
      : null,
    highestBerlin: highestBerlin
      ? {
          state: highestBerlin.state || "Berlin",
          regionName: highestBerlin.regionName || "Berlin",
          event: highestBerlin.event || "Unknown event",
          level: highestBerlin.level || 0,
          start: highestBerlin.start || null,
          end: highestBerlin.end || null,
        }
      : null,
  };
}

function getDeviceLabel(device: { deviceType?: string | null; deviceSn?: string | null }) {
  if (device.deviceType === "YUNENG_MICRO_INVERTER") {
    return `Micro Inverter${device.deviceSn ? ` - ${device.deviceSn}` : ""}`;
  }

  if (device.deviceType === "SOLAR_MICRO_INVERTER") {
    return `Solar Inverter${device.deviceSn ? ` - ${device.deviceSn}` : ""}`;
  }

  if (device.deviceType === "ENERGY_STORAGE_BATTERY") {
    return `Battery${device.deviceSn ? ` - ${device.deviceSn}` : ""}`;
  }

  return device.deviceSn || device.deviceType || "Sunlit device";
}

async function getSunlitAutomationSnapshot(familyId?: number) {
  const session = await readSunlitSession();
  const credentials: SunlitCredentials | undefined = session
    ? {
        email: session.email,
        password: session.password,
      }
    : undefined;

  try {
    const dashboard = await getDashboardData(familyId, credentials);
    const { selectedFamily, devices, currentStrategy, spaceIndex } = dashboard;

    return {
      familyId: selectedFamily.id,
      familyName: selectedFamily.name,
      batteryLevel: spaceIndex?.battery?.batteryLevel ?? spaceIndex?.battery?.batterySoc ?? null,
      solarPowerW: spaceIndex?.inverter?.currentPower ?? null,
      homePowerW: spaceIndex?.today?.homePower ?? spaceIndex?.eleMeter?.totalAcPower ?? null,
      strategy: currentStrategy?.strategy || null,
      devices: devices.map((device) => ({
        id: device.deviceId,
        label: getDeviceLabel(device),
        serial: device.deviceSn || null,
        type: device.deviceType || null,
        controllable: isInverterDevice(device),
      })),
    };
  } catch {
    return null;
  }
}

function parseSolarNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeForecastHourly(
  result: Record<string, number>,
  berlinDateKey: string,
): {
  hourly: SolarForecastPoint[];
  todayTotalWh: number | null;
  tomorrowTotalWh: number | null;
  tomorrowPeakW: number | null;
  tomorrowPeakHour: string | null;
} {
  const today = berlinDateKey;
  const tomorrowDate = new Date(`${berlinDateKey}T00:00:00`);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);
  const buckets = new Map<string, SolarForecastPoint>();

  for (const [key, watts] of Object.entries(result)) {
    const [datePart, timePart = "00:00:00"] = key.split(" ");
    const [hourText] = timePart.split(":");
    const hour = Number(hourText);

    if (!Number.isFinite(hour)) {
      continue;
    }

    const dayOffset = datePart === today ? 0 : datePart === tomorrow ? 1 : null;

    if (dayOffset === null) {
      continue;
    }

    const bucketKey = `${datePart}-${hour}`;
    const localTime = `${hour.toString().padStart(2, "0")}:00`;
    const existing = buckets.get(bucketKey);
    const point: SolarForecastPoint = {
      key,
      date: datePart,
      hour,
      localTime,
      dayOffset,
      watts: Math.max(0, Math.round(watts)),
    };

    if (!existing || point.watts >= existing.watts) {
      buckets.set(bucketKey, point);
    }
  }

  const hourly = [...buckets.values()].sort((left, right) => {
    if (left.date === right.date) {
      return left.hour - right.hour;
    }

    return left.date.localeCompare(right.date);
  });

  const todayHourly = hourly.filter((item) => item.dayOffset === 0);
  const tomorrowHourly = hourly.filter((item) => item.dayOffset === 1);
  const tomorrowPeak = tomorrowHourly.reduce<SolarForecastPoint | null>(
    (best, current) => (!best || current.watts > best.watts ? current : best),
    null,
  );

  return {
    hourly,
    todayTotalWh: todayHourly.length > 0 ? todayHourly.reduce((sum, item) => sum + item.watts, 0) : null,
    tomorrowTotalWh: tomorrowHourly.length > 0 ? tomorrowHourly.reduce((sum, item) => sum + item.watts, 0) : null,
    tomorrowPeakW: tomorrowPeak?.watts ?? null,
    tomorrowPeakHour: tomorrowPeak?.localTime ?? null,
  };
}

async function getSolarForecastSnapshot(
  berlinDateKey: string,
  plant: {
    latitude: number;
    longitude: number;
    declination: number;
    azimuth: number;
    kwp: number;
  } | null,
) {
  if (!plant) {
    return null;
  }

  const endpoint = `https://api.forecast.solar/estimate/watts/${plant.latitude}/${plant.longitude}/${plant.declination}/${plant.azimuth}/${plant.kwp}`;
  const response = await fetch(endpoint, {
    next: { revalidate: 1800 },
  });

  if (!response.ok) {
    throw new Error(`solar_forecast_${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: Record<string, number>;
    message?: {
      info?: {
        place?: string;
        timezone?: string;
        time?: string;
      };
    };
  };

  const normalized = normalizeForecastHourly(payload.result || {}, berlinDateKey);

  return {
    source: "forecast.solar",
    plant: {
      ...plant,
      place: payload.message?.info?.place || null,
      timezone: payload.message?.info?.timezone || null,
      generatedAt: payload.message?.info?.time || null,
    },
    ...normalized,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const familyIdParam = Number(searchParams.get("familyId"));
  const familyId = Number.isFinite(familyIdParam) && familyIdParam > 0 ? familyIdParam : undefined;
  const now = new Date();
  const berlinTime = formatBerlinTime(now);
  const latitude = parseSolarNumber(searchParams.get("latitude"));
  const longitude = parseSolarNumber(searchParams.get("longitude"));
  const declination = parseSolarNumber(searchParams.get("declination"));
  const azimuth = parseSolarNumber(searchParams.get("azimuth"));
  const kwp = parseSolarNumber(searchParams.get("kwp"));
  const solarPlant =
    latitude !== null && longitude !== null && declination !== null && azimuth !== null && kwp !== null
      ? { latitude, longitude, declination, azimuth, kwp }
      : null;

  const [weatherResult, priceResult, warningsResult, sunlitResult, solarForecastResult] = await Promise.allSettled([
    getWeatherSnapshot(),
    getGermanPriceSnapshot(),
    getDwdWarningsSnapshot(),
    getSunlitAutomationSnapshot(familyId),
    getSolarForecastSnapshot(berlinTime.dateKey, solarPlant),
  ]);

  const sunlitPayload = sunlitResult.status === "fulfilled" ? sunlitResult.value : null;
  const solarForecastPayload = solarForecastResult.status === "fulfilled" ? solarForecastResult.value : null;

  const issues = [
    weatherResult.status === "rejected" ? "weather_unavailable" : null,
    priceResult.status === "rejected" ? "price_unavailable" : null,
    warningsResult.status === "rejected" ? "warnings_unavailable" : null,
    sunlitResult.status === "rejected" || !sunlitPayload ? "sunlit_unavailable" : null,
    solarPlant && (solarForecastResult.status === "rejected" || !solarForecastPayload) ? "solar_forecast_unavailable" : null,
  ].filter(Boolean);

  return NextResponse.json({
    refreshedAt: now.getTime(),
    berlinTime: {
      iso: berlinTime.iso,
      display: berlinTime.display,
      hour: berlinTime.hour,
      minute: berlinTime.minute,
      timezone: berlinTime.timezone,
    },
    weather: weatherResult.status === "fulfilled" ? weatherResult.value : null,
    electricity: priceResult.status === "fulfilled" ? priceResult.value : null,
    warnings: warningsResult.status === "fulfilled" ? warningsResult.value : null,
    sunlit: sunlitPayload,
    solarForecast: solarForecastPayload,
    issues,
  });
}
