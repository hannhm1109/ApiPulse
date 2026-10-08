export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10 sm:px-10">
      <header className="border-b border-zinc-200 pb-6">
        <h1 className="text-2xl font-semibold text-zinc-950">API Pulse</h1>
      </header>
      <section className="py-10" aria-labelledby="endpoints-heading">
        <h2 id="endpoints-heading" className="text-lg font-medium text-zinc-900">
          Endpoints
        </h2>
        <p className="mt-3 text-sm text-zinc-500">Monitoring has not started.</p>
      </section>
    </main>
  );
}
