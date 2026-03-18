import { NextRequest, NextResponse } from "next/server";

import { loginUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    email?: string;
    password?: string;
  };

  const result = await loginUser(body.email || "", body.password || "");
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
