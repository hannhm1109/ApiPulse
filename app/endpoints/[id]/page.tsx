import { notFound } from "next/navigation";
import { DetailView } from "../../../components/endpoint-detail/detail-view";
import { getEndpointDetail } from "../../../server/endpoint-detail/detail-service";
import { prisma } from "../../../server/db/prisma";
import type { HistoryQuery } from "../../../server/endpoint-detail/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Endpoint detail | API Pulse" };

export default async function EndpointDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<HistoryQuery> }) {
  const { id } = await params;
  const data = await getEndpointDetail(prisma, id, await searchParams);
  if (!data) notFound();
  return <DetailView data={data} />;
}
