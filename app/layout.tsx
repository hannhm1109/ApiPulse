import type { Metadata } from "next";
import { Geist, Space_Grotesk } from "next/font/google";
import { AppHeader } from "../components/app-header";
import { AppContext } from "../components/app-nav";
import { isReadOnlyDeployment } from "../server/deployment";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-ui" });
const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "API Pulse",
  description: "HTTP endpoint monitoring, uptime, latency, and incidents.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${space.variable}`}>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <AppHeader />
        <div className="app-workspace"><AppContext readOnly={isReadOnlyDeployment()} />{children}</div>
      </body>
    </html>
  );
}
