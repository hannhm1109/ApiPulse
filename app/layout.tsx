import type { Metadata } from "next";
import { AppHeader } from "../components/app-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Pulse",
  description: "HTTP endpoint monitoring, uptime, latency, and incidents.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><a className="skip-link" href="#main-content">Skip to content</a><AppHeader />{children}</body>
    </html>
  );
}
