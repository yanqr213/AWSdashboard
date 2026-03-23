import { NextRequest, NextResponse } from "next/server";

import { updateCurrentUserPassword } from "@/lib/auth";

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as {
    currentPassword?: string;
    nextPassword?: string;
  };

  const result = await updateCurrentUserPassword(body.currentPassword || "", body.nextPassword || "");
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
