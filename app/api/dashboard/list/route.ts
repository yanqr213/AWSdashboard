import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getDashboardListState } from "@/lib/iot-platform";

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录。" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const state = await getDashboardListState({
    environment: searchParams.get("environment") || undefined,
    deviceSearch: searchParams.get("deviceSearch") || undefined,
    deviceType: searchParams.get("deviceType") || undefined,
    page: parsePositiveInteger(searchParams.get("page"), 1),
    pageSize: parsePositiveInteger(searchParams.get("pageSize"), 10),
  });

  return NextResponse.json(state, {
    headers: {
      "cache-control": "private, max-age=20, stale-while-revalidate=60",
    },
  });
}
