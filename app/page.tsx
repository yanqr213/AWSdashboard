import { Suspense } from "react";

import { DashboardListClient } from "@/app/dashboard/list-client";
import { DashboardListSkeleton } from "@/app/dashboard/loading-shell";
import { requireAuthenticatedUser } from "@/lib/auth";
import { getDashboardListState } from "@/lib/iot-platform";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function DashboardListContent({ searchParams }: { searchParams?: SearchParams }) {
  const params = searchParams ? await searchParams : {};
  const initialState = await getDashboardListState({
    environment: readParam(params.environment),
    deviceSearch: readParam(params.deviceSearch),
    deviceType: readParam(params.deviceType),
    page: Number(readParam(params.page) || 1),
    pageSize: Number(readParam(params.pageSize) || 10),
  });

  return <DashboardListClient initialState={initialState} />;
}

export default async function Home({ searchParams }: { searchParams?: SearchParams }) {
  await requireAuthenticatedUser();

  return (
    <Suspense fallback={<DashboardListSkeleton />}>
      <DashboardListContent searchParams={searchParams} />
    </Suspense>
  );
}
