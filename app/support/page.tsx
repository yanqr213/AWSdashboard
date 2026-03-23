import { SupportWorkbenchClient } from "@/app/support/workbench-client";
import { requireAuthenticatedUser } from "@/lib/auth";
import { getSupportWorkbenchState } from "@/lib/iot-platform";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SupportPage({ searchParams }: { searchParams?: SearchParams }) {
  await requireAuthenticatedUser();
  const params = searchParams ? await searchParams : {};
  const initialState = await getSupportWorkbenchState({
    environment: readParam(params.environment),
  });

  return <SupportWorkbenchClient initialState={initialState} />;
}
