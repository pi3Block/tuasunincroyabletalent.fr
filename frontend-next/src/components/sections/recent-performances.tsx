"use client";

import { memo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Star,
  Clock,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { api, type PerformanceHistoryItem } from "@/api/client";

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) return `il y a ${diffMins} min`;
  if (diffHours < 24) return `il y a ${diffHours}h`;
  return `il y a ${diffDays}j`;
}

function getScoreColor(score: number): string {
  if (score >= 90) return "text-green-400";
  if (score >= 80) return "text-yellow-400";
  if (score >= 70) return "text-orange-400";
  return "text-red-400";
}

function getScoreGradient(score: number): string {
  if (score >= 90) return "from-green-500 to-emerald-600";
  if (score >= 80) return "from-yellow-500 to-amber-600";
  if (score >= 70) return "from-orange-500 to-red-500";
  return "from-red-500 to-rose-600";
}

const PerformanceCard = memo(function PerformanceCard({
  performance,
  index,
}: {
  performance: PerformanceHistoryItem;
  index: number;
}) {
  const juryComment = performance.jury_comments[0]?.comment ?? "";
  const timestamp = new Date(performance.created_at);

  return (
    <motion.div
      className="relative min-w-[280px] md:min-w-[320px] snap-center"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.1, duration: 0.4 }}
    >
      <motion.div
        className="relative p-5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm overflow-hidden"
        whileHover={{
          scale: 1.02,
          backgroundColor: "rgba(255,255,255,0.08)",
        }}
        transition={{ duration: 0.2 }}
      >
        <div
          className={`absolute top-4 right-4 px-3 py-1 rounded-full bg-linear-to-r ${getScoreGradient(performance.total_score)} text-white text-sm font-bold shadow-lg`}
        >
          {performance.total_score}%
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-linear-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
            🎤
          </div>
          <div>
            <div className="text-white font-medium text-sm">Anonyme</div>
            <div className="text-gray-500 text-xs flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatRelativeTime(timestamp)}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <h4 className="text-white font-semibold text-lg truncate">
            {performance.track_name}
          </h4>
          <p className="text-gray-400 text-sm truncate">
            {performance.artist_name}
          </p>
        </div>

        {juryComment && (
          <div className="p-3 rounded-lg bg-white/5 border border-white/5 mb-4">
            <p className="text-gray-300 text-sm italic">
              &ldquo;{juryComment}&rdquo;
            </p>
          </div>
        )}

        <div className="flex items-center justify-end text-xs">
          <div className="flex items-center gap-1">
            <Star
              className={`w-3 h-3 ${getScoreColor(performance.total_score)}`}
            />
            <span className={getScoreColor(performance.total_score)}>
              {performance.total_score >= 90
                ? "Excellent"
                : performance.total_score >= 80
                  ? "Très bien"
                  : performance.total_score >= 70
                    ? "Bien"
                    : "À améliorer"}
            </span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
});

const SkeletonCard = memo(function SkeletonCard() {
  return (
    <div className="relative min-w-[280px] md:min-w-[320px] snap-center">
      <div className="p-5 rounded-2xl bg-white/5 border border-white/10 animate-pulse">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-white/10" />
          <div className="space-y-2">
            <div className="h-3 w-24 rounded bg-white/10" />
            <div className="h-2 w-16 rounded bg-white/10" />
          </div>
        </div>
        <div className="space-y-2 mb-4">
          <div className="h-5 w-40 rounded bg-white/10" />
          <div className="h-3 w-28 rounded bg-white/10" />
        </div>
        <div className="h-12 rounded-lg bg-white/10 mb-4" />
        <div className="h-3 w-16 rounded bg-white/10 ml-auto" />
      </div>
    </div>
  );
});

const LiveIndicator = memo(function LiveIndicator() {
  return (
    <motion.div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/20 border border-red-500/30"
      animate={{ opacity: [1, 0.5, 1] }}
      transition={{ duration: 2, repeat: Infinity }}
    >
      <motion.div
        className="w-2 h-2 rounded-full bg-red-500"
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ duration: 1, repeat: Infinity }}
      />
      <span className="text-red-400 text-sm font-medium">En direct</span>
    </motion.div>
  );
});

export const RecentPerformancesSection = memo(
  function RecentPerformancesSection() {
    const [performances, setPerformances] = useState<PerformanceHistoryItem[]>(
      [],
    );
    const [loading, setLoading] = useState(true);
    const [currentIndex, setCurrentIndex] = useState(0);
    const visibleCount = 3;

    useEffect(() => {
      api
        .getResultsHistory(6)
        .then(setPerformances)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, []);

    // Masquer la section si aucune donnée après chargement
    if (!loading && performances.length === 0) return null;

    const canScrollLeft = currentIndex > 0;
    const canScrollRight =
      currentIndex < performances.length - visibleCount;

    const scrollLeft = () => {
      if (canScrollLeft) setCurrentIndex(currentIndex - 1);
    };

    const scrollRight = () => {
      if (canScrollRight) setCurrentIndex(currentIndex + 1);
    };

    return (
      <section className="relative py-20 px-4 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-72 h-72 bg-pink-600/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-gold-600/10 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto">
          <motion.div
            className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
          >
            <div>
              <div className="flex items-center gap-3 mb-3">
                <LiveIndicator />
                {!loading && (
                  <motion.span
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-500/20 border border-green-500/30 text-green-400 text-sm"
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 }}
                  >
                    <TrendingUp className="w-3 h-3" />
                    {performances.length} récentes
                  </motion.span>
                )}
              </div>

              <h2 className="text-3xl md:text-4xl font-bold text-white">
                Performances{" "}
                <span className="bg-gradient-to-r from-pink-400 to-gold-500 bg-clip-text text-transparent">
                  récentes
                </span>
              </h2>
            </div>

            {!loading && performances.length > visibleCount && (
              <div className="hidden md:flex items-center gap-2">
                <motion.button
                  className={`p-2 rounded-full border ${
                    canScrollLeft
                      ? "border-white/20 text-white hover:bg-white/10"
                      : "border-white/10 text-white/30 cursor-not-allowed"
                  }`}
                  onClick={scrollLeft}
                  disabled={!canScrollLeft}
                  whileHover={canScrollLeft ? { scale: 1.1 } : {}}
                  whileTap={canScrollLeft ? { scale: 0.9 } : {}}
                >
                  <ChevronLeft className="w-5 h-5" />
                </motion.button>
                <motion.button
                  className={`p-2 rounded-full border ${
                    canScrollRight
                      ? "border-white/20 text-white hover:bg-white/10"
                      : "border-white/10 text-white/30 cursor-not-allowed"
                  }`}
                  onClick={scrollRight}
                  disabled={!canScrollRight}
                  whileHover={canScrollRight ? { scale: 1.1 } : {}}
                  whileTap={canScrollRight ? { scale: 0.9 } : {}}
                >
                  <ChevronRight className="w-5 h-5" />
                </motion.button>
              </div>
            )}
          </motion.div>

          {/* Mobile: horizontal swipe carousel */}
          <div className="lg:hidden overflow-x-auto pb-4 -mx-4 px-4 snap-x snap-mandatory scrollbar-hide">
            <div className="flex gap-4">
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <SkeletonCard key={i} />
                  ))
                : performances.map((performance, index) => (
                    <PerformanceCard
                      key={performance.session_id}
                      performance={performance}
                      index={index}
                    />
                  ))}
            </div>
          </div>

          {/* Desktop: static 3-column grid */}
          <div className="hidden lg:grid lg:grid-cols-3 gap-6">
            {loading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))
              : performances.map((performance, index) => (
                  <PerformanceCard
                    key={performance.session_id}
                    performance={performance}
                    index={index}
                  />
                ))}
          </div>

          {!loading && performances.length > 0 && (
            <div className="lg:hidden flex items-center justify-center gap-2 mt-6">
              {performances.map((_, index) => (
                <motion.div
                  key={index}
                  className={`w-2 h-2 rounded-full ${
                    index === 0 ? "bg-white" : "bg-white/30"
                  }`}
                  animate={index === 0 ? { scale: [1, 1.2, 1] } : {}}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              ))}
            </div>
          )}

          <motion.div
            className="text-center mt-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.5 }}
          >
            <p className="text-gray-400 mb-4">
              Rejoins la communauté et montre ton talent !
            </p>
            <Link href="/app">
              <motion.span
                className="inline-block px-6 py-3 rounded-full bg-linear-to-r from-purple-500 to-pink-500 text-white font-semibold shadow-lg shadow-purple-500/25 cursor-pointer"
                whileHover={{
                  scale: 1.05,
                  boxShadow: "0 20px 40px -10px rgba(168, 85, 247, 0.4)",
                }}
                whileTap={{ scale: 0.95 }}
              >
                C&apos;est mon tour !
              </motion.span>
            </Link>
          </motion.div>
        </div>
      </section>
    );
  },
);

export default RecentPerformancesSection;
