export default function Loading() {
  return (
    <div role="status" className="animate-pulse space-y-4" aria-label="Loading">
      <div className="bg-surface-muted h-10 w-1/3 rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-surface-muted h-24 rounded-2xl" />
        ))}
      </div>
      <div className="bg-surface-muted h-64 rounded-2xl" />
    </div>
  );
}
