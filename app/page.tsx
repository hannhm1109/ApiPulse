import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "../server/db/prisma";
import { listEndpoints } from "../server/endpoints/endpoint-service";
import { EndpointList } from "../components/endpoints/endpoint-list";

export const dynamic = "force-dynamic";

export default async function Home() {
  const endpoints = await listEndpoints(prisma);
  return (
    <main className="page-container" id="main-content">
      <div className="page-heading"><div className="heading-with-count"><h1>Endpoints</h1><span className="heading-count">{endpoints.length}</span></div>
        <Link href="/endpoints/new" className="button button-primary"><Plus size={17} aria-hidden="true" />Add endpoint</Link>
      </div>
      <EndpointList endpoints={endpoints} />
    </main>
  );
}
