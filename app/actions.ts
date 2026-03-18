"use server";

import { redirect } from "next/navigation";

import { clearSunlitSession, readSunlitSession, writeSunlitSession } from "@/lib/sunlit-session";
import { getFamilies, setDevicePowerLimit, type SunlitCredentials } from "@/lib/sunlit-api";

function buildRedirectUrl(
  familyId: number | null,
  noticeType: "success" | "error",
  notice: string,
) {
  const search = new URLSearchParams({
    noticeType,
    notice,
  });

  if (familyId !== null && Number.isFinite(familyId)) {
    search.set("familyId", String(familyId));
  }

  return `/?${search.toString()}`;
}

async function getActionContext() {
  const session = await readSunlitSession();

  return session
    ? {
        email: session.email,
        password: session.password,
      } satisfies SunlitCredentials
    : undefined;
}

export async function setDevicePowerLimitAction(formData: FormData) {
  const familyId = Number(formData.get("familyId"));
  const deviceId = Number(formData.get("deviceId"));
  const maxOutputPower = Number(formData.get("maxOutputPower"));

  if (!Number.isFinite(familyId) || !Number.isFinite(deviceId) || !Number.isFinite(maxOutputPower)) {
    redirect(buildRedirectUrl(familyId || null, "error", "Missing or invalid control parameters."));
  }

  try {
    await setDevicePowerLimit(deviceId, maxOutputPower, await getActionContext());
    redirect(
      buildRedirectUrl(
        familyId,
        "success",
        `Power limit update was sent for device ${deviceId}. Refresh in a few seconds to confirm final status.`,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown control error";
    redirect(buildRedirectUrl(familyId, "error", message));
  }
}

export async function saveSunlitCredentialsAction(formData: FormData) {
  const returnFamilyId = Number(formData.get("returnFamilyId"));
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();

  if (!email || !password) {
    redirect(buildRedirectUrl(returnFamilyId || null, "error", "Please enter both Sunlit email and password."));
  }

  try {
    await getFamilies({ email, password });
    await writeSunlitSession(email, password);
    redirect(
      buildRedirectUrl(
        returnFamilyId || null,
        "success",
        "Sunlit credentials saved. Dashboard is now using session-based login.",
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sunlit login failed";
    redirect(buildRedirectUrl(returnFamilyId || null, "error", message));
  }
}

export async function clearSunlitCredentialsAction(formData: FormData) {
  const returnFamilyId = Number(formData.get("returnFamilyId"));
  await clearSunlitSession();
  redirect(buildRedirectUrl(returnFamilyId || null, "success", "Saved Sunlit session was cleared."));
}
