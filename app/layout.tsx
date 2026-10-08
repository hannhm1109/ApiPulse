import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Pulse",
  description: "HTTP endpoint monitoring, uptime, latency, and incidents.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
