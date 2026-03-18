import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getDashboardState } from "@/lib/iot-platform";

function parseHours(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录。" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const state = await getDashboardState({
    environment: searchParams.get("environment") || undefined,
    deviceId: searchParams.get("deviceId") || undefined,
    metricId: searchParams.get("metricId") || undefined,
    deviceSearch: searchParams.get("deviceSearch") || undefined,
    fieldSearch: searchParams.get("fieldSearch") || undefined,
    startAt: searchParams.get("startAt") || undefined,
    endAt: searchParams.get("endAt") || undefined,
    hours: parseHours(searchParams.get("hours")),
  });

  return NextResponse.json(state, {
    headers: {
      "cache-control": "private, max-age=30, stale-while-revalidate=120",
    },
  });
}
