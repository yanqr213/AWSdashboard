import { NextResponse } from "next/server";

import { logoutCurrentUser } from "@/lib/auth";

export async function POST() {
  await logoutCurrentUser();

  return NextResponse.json({
    ok: true,
  });
}
