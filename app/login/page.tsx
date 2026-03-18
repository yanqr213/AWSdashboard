import { redirect } from "next/navigation";

import { AuthForm } from "@/app/auth-form";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/");
  }

  return (
    <main className="app-shell auth-page-shell">
      <AuthForm mode="login" />
    </main>
  );
}
