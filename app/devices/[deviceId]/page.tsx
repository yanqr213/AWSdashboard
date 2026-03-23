import { Suspense } from "react";

import { DashboardDetailClient } from "@/app/dashboard/detail-client";
import { DashboardDetailSkeleton } from "@/app/dashboard/loading-shell";
import { requireAuthenticatedUser } from "@/lib/auth";
import { getDashboardDetailState } from "@/lib/iot-platform";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function DeviceDetailContent({
  deviceId,
  searchParams,
}: {
  deviceId: string;
  searchParams?: SearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  const initialState = await getDashboardDetailState({
    environment: readParam(params.environment),
    deviceId,
  });

  return <DashboardDetailClient initialState={initialState} deviceId={deviceId} />;
}

export default async function DeviceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ deviceId: string }>;
  searchParams?: SearchParams;
}) {
  await requireAuthenticatedUser();
  const { deviceId } = await params;

  return (
    <Suspense fallback={<DashboardDetailSkeleton />}>
      <DeviceDetailContent deviceId={deviceId} searchParams={searchParams} />
    </Suspense>
  );
}
