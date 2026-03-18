import { NextResponse } from "next/server";

import { readSunlitSession } from "@/lib/sunlit-session";
import { setDevicePowerLimit, type SunlitCredentials } from "@/lib/sunlit-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    deviceId?: number;
    maxOutputPower?: number;
  };

  if (!Number.isFinite(body.deviceId) || !Number.isFinite(body.maxOutputPower)) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const session = await readSunlitSession();
  const credentials: SunlitCredentials | undefined = session
    ? {
        email: session.email,
        password: session.password,
      }
    : undefined;

  try {
    await setDevicePowerLimit(body.deviceId as number, body.maxOutputPower as number, credentials);

    return NextResponse.json({
      ok: true,
      executedAt: Date.now(),
      deviceId: body.deviceId,
      maxOutputPower: body.maxOutputPower,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "execution_failed",
      },
      { status: 500 },
    );
  }
}
