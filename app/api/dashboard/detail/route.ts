import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getDashboardDetailState } from "@/lib/iot-platform";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录。" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const state = await getDashboardDetailState({
    environment: searchParams.get("environment") || undefined,
    deviceId: searchParams.get("deviceId") || undefined,
  });

  return NextResponse.json(state, {
    headers: {
      "cache-control": "private, no-store",
    },
  });
}
