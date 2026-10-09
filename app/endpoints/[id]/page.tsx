import { notFound } from "next/navigation";
import { DetailView } from "../../../components/endpoint-detail/detail-view";
import { getEndpointDetail } from "../../../server/endpoint-detail/detail-service";
import { prisma } from "../../../server/db/prisma";
import type { HistoryQuery } from "../../../server/endpoint-detail/types";
import { loadPageData } from "../../../server/page-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Endpoint detail | API Pulse" };

export default async function EndpointDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<HistoryQuery> }) {
  const { id } = await params;
  const query = await searchParams;
  const data = await loadPageData("endpoint_detail_read_error", () => getEndpointDetail(prisma, id, query));
  if (!data) notFound();
  return <DetailView data={data} />;
}
