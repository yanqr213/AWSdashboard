import { NextRequest, NextResponse } from "next/server";

import {
  createAccountByAdmin,
  deleteAccountByAdmin,
  getCurrentUser,
  listAccountsForAdmin,
  updateAccountPasswordByAdmin,
} from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录。" }, { status: 401 });
  }
  if (user.role !== "super-admin") {
    return NextResponse.json({ ok: false, error: "没有权限。" }, { status: 403 });
  }
  const users = await listAccountsForAdmin();
  return NextResponse.json({
    ok: true,
    users,
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录。" }, { status: 401 });
  }
  if (user.role !== "super-admin") {
    return NextResponse.json({ ok: false, error: "没有权限。" }, { status: 403 });
  }
  const body = (await request.json()) as {
    email?: string;
    password?: string;
    role?: "super-admin" | "user";
  };

  const result = await createAccountByAdmin(body.email || "", body.password || "", body.role || "user");
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录。" }, { status: 401 });
  }
  if (user.role !== "super-admin") {
    return NextResponse.json({ ok: false, error: "没有权限。" }, { status: 403 });
  }
  const body = (await request.json()) as {
    userId?: string;
    password?: string;
  };

  const result = await updateAccountPasswordByAdmin(body.userId || "", body.password || "");
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录。" }, { status: 401 });
  }
  if (user.role !== "super-admin") {
    return NextResponse.json({ ok: false, error: "没有权限。" }, { status: 403 });
  }
  const body = (await request.json()) as {
    userId?: string;
  };

  const result = await deleteAccountByAdmin(body.userId || "");
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
