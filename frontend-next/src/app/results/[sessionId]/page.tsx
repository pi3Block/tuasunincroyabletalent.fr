import type { Metadata } from "next";
import Link from "next/link";

interface Props {
  params: Promise<{ sessionId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sessionId } = await params;
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL || "https://api.kiaraoke.fr";

  try {
    const res = await fetch(`${apiUrl}/api/results/${sessionId}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error("Not found");
    const data = await res.json();
    const r = data.results;

    return {
      title: `${r.score}/100 — ${r.track_name || "Performance"}`,
      description: `Justesse ${Math.round(r.pitch_accuracy)}% | Rythme ${Math.round(r.rhythm_accuracy)}% | Paroles ${Math.round(r.lyrics_accuracy)}%`,
      openGraph: {
        title: `J'ai obtenu ${r.score}/100 sur "${r.track_name}" !`,
        description: `Justesse ${Math.round(r.pitch_accuracy)}% | Rythme ${Math.round(r.rhythm_accuracy)}% | Paroles ${Math.round(r.lyrics_accuracy)}%`,
        images: [r.album_image || "/og-image.png"],
      },
    };
  } catch {
    return { title: "Résultats — Kiaraoke" };
  }
}

export default async function ResultsPage({ params }: Props) {
  const { sessionId } = await params;
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL || "https://api.kiaraoke.fr";

  let results = null;
  try {
    const res = await fetch(`${apiUrl}/api/results/${sessionId}`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const data = await res.json();
      results = data.results;
    }
  } catch {
    // Results not found
  }

  if (!results) {
    return (
      <main className="flex flex-col items-center justify-center p-8 min-h-[calc(100vh-56px)]">
        <div className="text-center space-y-4">
          <span className="text-6xl">🎤</span>
          <h1 className="text-2xl font-bold">Résultats non trouvés</h1>
          <p className="text-muted-foreground">
            Cette performance n&apos;existe pas ou a expiré.
          </p>
          <Link
            href="/"
            className="inline-block mt-4 px-6 py-3 bg-gold-500 text-gray-900 font-bold rounded-full hover:bg-gold-400 transition"
          >
            Essayer Kiaraoke
          </Link>
        </div>
      </main>
    );
  }

  const getColor = (v: number) => {
    if (v >= 80) return "text-green-400";
    if (v >= 60) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <main className="p-4 md:p-8">
      <div className="max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl mx-auto space-y-6">

        {/* Score */}
        <div className="text-center">
          <div className="w-28 h-28 mx-auto rounded-full bg-linear-to-br from-gold-400 to-gold-600 flex items-center justify-center shadow-lg">
            <span className="text-4xl font-bold text-gray-900">
              {results.score}
            </span>
          </div>
          {results.track_name && (
            <p className="text-lg font-semibold mt-3">{results.track_name}</p>
          )}
          {results.artist_name && (
            <p className="text-muted-foreground">{results.artist_name}</p>
          )}
          <p className="text-muted-foreground mt-1">Score global</p>
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card rounded-lg p-3 text-center border border-border">
            <p className={`text-2xl font-bold ${getColor(results.pitch_accuracy)}`}>
              {Math.round(results.pitch_accuracy)}%
            </p>
            <p className="text-xs text-muted-foreground">Justesse</p>
          </div>
          <div className="bg-card rounded-lg p-3 text-center border border-border">
            <p className={`text-2xl font-bold ${getColor(results.rhythm_accuracy)}`}>
              {Math.round(results.rhythm_accuracy)}%
            </p>
            <p className="text-xs text-muted-foreground">Rythme</p>
          </div>
          <div className="bg-card rounded-lg p-3 text-center border border-border">
            <p className={`text-2xl font-bold ${getColor(results.lyrics_accuracy)}`}>
              {Math.round(results.lyrics_accuracy)}%
            </p>
            <p className="text-xs text-muted-foreground">Paroles</p>
          </div>
        </div>

        {/* Jury votes */}
        {Array.isArray(results.jury_comments) && results.jury_comments.length > 0 && (
          <>
            <div className="flex justify-center gap-4">
              {results.jury_comments.map(
                (
                  jury: { persona: string; comment: string; vote: string },
                  i: number,
                ) => (
                  <div
                    key={i}
                    className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl ${
                      jury.vote === "yes"
                        ? "bg-green-500/20 border-2 border-green-500"
                        : "bg-red-500/20 border-2 border-red-500"
                    }`}
                  >
                    {jury.vote === "yes" ? "👍" : "👎"}
                  </div>
                ),
              )}
            </div>

            <div>
              <h2 className="text-lg font-semibold text-center mb-3">
                Le jury a dit:
              </h2>
              <div className="space-y-3 lg:grid lg:grid-cols-3 lg:gap-6 lg:space-y-0">
                {results.jury_comments.map(
                  (
                    jury: { persona: string; comment: string; vote: string },
                    i: number,
                  ) => (
                    <div
                      key={i}
                      className="bg-card rounded-xl p-4 text-left border border-border"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gold-400">
                          {jury.persona}
                        </span>
                        <span
                          className={
                            jury.vote === "yes"
                              ? "text-green-400"
                              : "text-red-400"
                          }
                        >
                          ({jury.vote === "yes" ? "OUI" : "NON"})
                        </span>
                      </div>
                      <p className="text-muted-foreground text-sm italic">
                        &ldquo;{jury.comment}&rdquo;
                      </p>
                    </div>
                  ),
                )}
              </div>
            </div>
          </>
        )}

        {/* CTA */}
        <div className="text-center">
          <a
            href="/app"
            className="inline-block px-8 py-4 bg-linear-to-r from-gold-400 to-gold-600 text-gray-900 font-bold rounded-full text-lg shadow-lg hover:scale-105 transition-transform"
          >
            C&apos;est mon tour !
          </a>
        </div>
      </div>
    </main>
  );
}
