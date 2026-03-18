import { DashboardClient } from "@/app/dashboard-client";
import { requireAuthenticatedUser } from "@/lib/auth";
import { getDashboardState } from "@/lib/iot-platform";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseHours(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default async function Home({ searchParams }: { searchParams?: SearchParams }) {
  await requireAuthenticatedUser();
  const params = searchParams ? await searchParams : {};
  const initialState = await getDashboardState({
    environment: readParam(params.environment),
    deviceId: readParam(params.deviceId),
    metricId: readParam(params.metricId),
    deviceSearch: readParam(params.deviceSearch),
    fieldSearch: readParam(params.fieldSearch),
    startAt: readParam(params.startAt),
    endAt: readParam(params.endAt),
    hours: parseHours(readParam(params.hours)),
  });

  return <DashboardClient initialState={initialState} />;
}
