import { NextRequest, NextResponse } from "next/server";

import { registerUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    email?: string;
    password?: string;
  };

  const result = await registerUser(body.email || "", body.password || "");
  return NextResponse.json(result, { status: 403 });
}
