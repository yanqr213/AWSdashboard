import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, Noto_Sans_SC } from "next/font/google";

import { LogoutButton } from "@/app/logout-button";
import { getCurrentUser } from "@/lib/auth";

import "./globals.css";

const notoSansSc = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "TB 设备平台",
  description: "基于物模型中文字段的 TB 设备监控、历史数据与 OTA 管理平台。",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  return (
    <html lang="zh-CN">
      <body className={`${notoSansSc.variable} ${plexMono.variable}`}>
        <header className="site-nav-shell">
          <nav className="site-nav">
            <Link href="/" className="site-nav-brand">
              TB 设备平台
            </Link>
            <div className="site-nav-links">
              <Link href="/" className="site-nav-link">
                设备监控
              </Link>
              <Link href="/ota" className="site-nav-link">
                OTA 管理
              </Link>
              {user?.role === "super-admin" ? (
                <Link href="/admin/users" className="site-nav-link">
                  账号管理
                </Link>
              ) : null}
            </div>
            <div className="site-nav-user">
              {user ? (
                <>
                  <span className="site-nav-user-email">{user.email}</span>
                  <LogoutButton />
                </>
              ) : (
                <>
                  <Link href="/login" className="site-nav-link">
                    登录
                  </Link>
                  <Link href="/register" className="site-nav-link">
                    注册
                  </Link>
                </>
              )}
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
