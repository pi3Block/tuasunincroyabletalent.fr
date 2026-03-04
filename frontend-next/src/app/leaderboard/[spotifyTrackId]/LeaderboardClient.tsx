"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { PerformanceCard } from "@/components/app/PerformanceCard";
import { api, type LeaderboardResponse } from "@/api/client";
import { cn } from "@/lib/utils";

const PERIODS = [
  { value: "week", label: "Cette semaine" },
  { value: "month", label: "Ce mois" },
  { value: "all", label: "Tout temps" },
] as const;

type Period = (typeof PERIODS)[number]["value"];

interface Props {
  spotifyTrackId: string;
  initial: LeaderboardResponse | null;
}

export function LeaderboardClient({ spotifyTrackId, initial }: Props) {
  const [period, setPeriod] = useState<Period>("all");
  const [data, setData] = useState<LeaderboardResponse | null>(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (period === "all" && initial) {
      setData(initial);
      return;
    }
    setLoading(true);
    api
      .getLeaderboard(spotifyTrackId, period, 20)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period, spotifyTrackId, initial]);

  const entries = data?.entries ?? [];
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const trackName = entries[0]?.track_name ?? "Chanson";
  const artistName = entries[0]?.artist_name ?? "";

  const PODIUM_ORDER = [1, 0, 2]; // silver, gold, bronze (gold in center)
  const MEDALS = ["🥇", "🥈", "🥉"];
  const MEDAL_STYLES = [
    "bg-yellow-400/20 border-yellow-400/50",
    "bg-zinc-400/20 border-zinc-400/50",
    "bg-amber-700/20 border-amber-700/50",
  ];

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="flex justify-center mb-3">
          <Trophy className="w-10 h-10 text-yellow-400" />
        </div>
        <h1 className="text-2xl font-bold">{trackName}</h1>
        <p className="text-muted-foreground">{artistName}</p>
      </div>

      {/* Period tabs */}
      <div className="flex justify-center gap-2 mb-8">
        {PERIODS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setPeriod(value)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium transition-colors",
              period === value
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-2xl bg-card/50 border border-border animate-pulse"
            />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-4xl mb-4">🎤</p>
          <p>Aucune performance publiee pour cette periode.</p>
        </div>
      ) : (
        <>
          {/* Podium top 3 */}
          {top3.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-8">
              {PODIUM_ORDER.map((idx) => {
                const entry = top3[idx];
                if (!entry) return <div key={idx} />;
                const r = entry.rank! - 1;
                return (
                  <motion.div
                    key={entry.session_id}
                    className={cn(
                      "rounded-xl border p-3 text-center",
                      MEDAL_STYLES[r],
                      r === 0 && "row-start-1",
                    )}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.1 }}
                  >
                    <div className="text-2xl mb-1">{MEDALS[r]}</div>
                    <p className="text-xs font-semibold truncate">
                      {entry.display_name ?? "Anonyme"}
                    </p>
                    <p className="text-lg font-bold text-primary">
                      {entry.score}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Rest */}
          <div className="space-y-3">
            {rest.map((entry, i) => (
              <PerformanceCard
                key={entry.session_id}
                performance={entry}
                index={i}
                rank={entry.rank}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
