"use client";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center min-h-[calc(100vh-56px)]">
      <p className="text-5xl mb-4">🎤</p>
      <h2 className="text-xl font-semibold mb-2">Une erreur est survenue</h2>
      <p className="text-muted-foreground text-sm mb-6 max-w-sm">
        Le studio a rencontré un problème. Tes données ne sont pas perdues.
      </p>
      <button
        onClick={reset}
        className="bg-primary text-primary-foreground px-6 py-2 rounded-full font-medium hover:bg-primary/90 transition"
      >
        Réessayer
      </button>
    </div>
  );
}
