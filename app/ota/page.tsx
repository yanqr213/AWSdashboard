import { redirect } from "next/navigation";

import { requireAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OtaPage() {
  await requireAuthenticatedUser();
  redirect("/");
}
