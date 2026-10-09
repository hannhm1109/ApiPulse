import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EndpointForm } from "../../../components/endpoints/endpoint-form";
import { notFound } from "next/navigation";
import { isReadOnlyDeployment } from "../../../server/deployment";

export const metadata = { title: "Add endpoint | API Pulse" };
export const dynamic = "force-dynamic";

export default function NewEndpoint() {
  if (isReadOnlyDeployment()) notFound();
  return (
    <main className="page-container form-page" id="main-content">
      <Link href="/" className="back-link"><ArrowLeft size={16} aria-hidden="true" />Endpoints</Link>
      <div className="form-page-heading"><span className="eyebrow">NEW ENDPOINT</span><h1>Add endpoint</h1></div>
      <EndpointForm />
    </main>
  );
}
