import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "../../../../server/db/prisma";
import { getEndpoint } from "../../../../server/endpoints/endpoint-service";
import { EndpointForm } from "../../../../components/endpoints/endpoint-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit endpoint | API Pulse" };

export default async function EditEndpoint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const endpoint = await getEndpoint(prisma, id);
  if (!endpoint) notFound();
  return (
    <main className="page-container form-page" id="main-content">
      <Link href="/" className="back-link"><ArrowLeft size={16} aria-hidden="true" />Endpoints</Link>
      <div className="form-page-heading"><span className="eyebrow">ENDPOINT SETTINGS</span><h1>Edit endpoint</h1><p className="edit-endpoint-name">{endpoint.name}</p></div>
      <EndpointForm key={endpoint.id} endpoint={endpoint} />
    </main>
  );
}
