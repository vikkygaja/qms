export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="card">
      <h1>{title}</h1>
      <p className="muted">This screen is built in a later slice.</p>
    </section>
  );
}

export function NotFoundPage() {
  return (
    <section className="card">
      <h1>Page not found</h1>
      <p className="muted">That address does not exist in QMS.</p>
    </section>
  );
}
