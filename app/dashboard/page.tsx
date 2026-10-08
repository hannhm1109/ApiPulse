import { prisma } from "../../server/db/prisma";
import { getDashboard } from "../../server/dashboard/dashboard-service";
import { DashboardView } from "../../components/dashboard/dashboard-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard | API Pulse" };

export default async function Dashboard() {
  const data = await getDashboard(prisma);
  return <main className="page-container" id="main-content"><DashboardView data={data} /></main>;
}
