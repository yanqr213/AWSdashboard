import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";

export async function POST(_request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录。" }, { status: 401 });
  }

  return NextResponse.json(
    {
      ok: false,
      error: "OTA 管理功能已下线。",
    },
    { status: 410 },
  );
}
