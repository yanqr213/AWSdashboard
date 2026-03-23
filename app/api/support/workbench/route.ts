import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getSupportWorkbenchState } from "@/lib/iot-platform";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录。" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const state = await getSupportWorkbenchState({
    environment: searchParams.get("environment") || undefined,
  });

  return NextResponse.json(state, {
    headers: {
      "cache-control": "private, max-age=20, stale-while-revalidate=60",
    },
  });
}
