import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "BASMA MARKETING", description: "نظام إدارة سير العمل والمحتوى التسويقي" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
