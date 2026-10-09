import { prisma } from "../../server/db/prisma";
import { getDashboard } from "../../server/dashboard/dashboard-service";
import { DashboardView } from "../../components/dashboard/dashboard-view";
import { loadPageData } from "../../server/page-data";
import { isReadOnlyDeployment } from "../../server/deployment";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard | API Pulse" };

export default async function Dashboard() {
  const data = await loadPageData("dashboard_read_error", () => getDashboard(prisma));
  return <main className="page-container" id="main-content"><DashboardView data={data} readOnly={isReadOnlyDeployment()} /></main>;
}
