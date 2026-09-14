import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Etykiety 100 × 150",
  description: "Przycina etykiety kurierskie z PDF-ów na format 100 × 150 mm",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
