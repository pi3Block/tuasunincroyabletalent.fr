"use client";

import { useState, useEffect, useCallback } from "react";
import { Flame, Clock, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { PerformanceCard } from "@/components/app/PerformanceCard";
import { api, type PublicPerformance } from "@/api/client";
import { cn } from "@/lib/utils";

type Sort = "recent" | "top";

export default function DiscoverPage() {
  const [sort, setSort] = useState<Sort>("recent");
  const [performances, setPerformances] = useState<PublicPerformance[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const fetchFeed = useCallback(
    async (p: number, s: Sort, reset = false) => {
      if (reset) setLoading(true);
      else setLoadingMore(true);
      try {
        const data = await api.getPublicFeed(p, 12, s);
        setPerformances((prev) =>
          reset ? data.results : [...prev, ...data.results],
        );
        setHasMore(data.results.length === 12);
      } catch {
        /* silently fail */
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchFeed(1, sort, true);
    setPage(1);
  }, [sort, fetchFeed]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchFeed(nextPage, sort);
  };

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          Decouvrir{" "}
          <span className="bg-gradient-to-r from-primary to-amber-400 bg-clip-text text-transparent">
            la communaute
          </span>
        </h1>
        <p className="text-muted-foreground">
          Les meilleures performances Kiaraoke
        </p>
      </div>

      {/* Sort tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setSort("recent")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors",
            sort === "recent"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-muted-foreground hover:text-foreground",
          )}
        >
          <Clock className="w-4 h-4" />
          Recentes
        </button>
        <button
          onClick={() => setSort("top")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors",
            sort === "top"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-muted-foreground hover:text-foreground",
          )}
        >
          <Flame className="w-4 h-4" />
          Top
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-64 rounded-2xl bg-card/50 border border-border animate-pulse"
            />
          ))}
        </div>
      ) : performances.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-4xl mb-4">🎤</p>
          <p>Aucune performance publiee pour l&apos;instant.</p>
          <p className="text-sm mt-2">Sois le premier !</p>
        </div>
      ) : (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          layout
        >
          {performances.map((p, i) => (
            <PerformanceCard
              key={p.session_id}
              performance={p}
              index={i}
            />
          ))}
        </motion.div>
      )}

      {/* Load more */}
      {!loading && hasMore && performances.length > 0 && (
        <div className="text-center mt-8">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-6 py-3 rounded-full bg-secondary border border-border text-sm font-medium hover:bg-accent transition-colors"
          >
            {loadingMore ? (
              <>
                <Loader2 className="w-4 h-4 inline mr-2 animate-spin" />
                Chargement...
              </>
            ) : (
              "Voir plus"
            )}
          </button>
        </div>
      )}
    </main>
  );
}
