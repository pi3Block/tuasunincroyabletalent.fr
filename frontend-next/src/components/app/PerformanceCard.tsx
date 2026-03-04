"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { Clock, Headphones } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { InlineAudioPlayer } from "./InlineAudioPlayer";
import { LikeButton } from "./LikeButton";
import type { PublicPerformance } from "@/api/client";

interface PerformanceCardProps {
  performance: PublicPerformance;
  index: number;
  initialLiked?: boolean;
  rank?: number;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "il y a quelques min";
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days}j`;
  return `il y a ${Math.floor(days / 30)} mois`;
}

function getScoreColor(score: number): string {
  if (score >= 90) return "from-green-500 to-emerald-600";
  if (score >= 80) return "from-yellow-500 to-amber-600";
  if (score >= 70) return "from-orange-500 to-red-500";
  return "from-red-500 to-rose-600";
}

const RANK_STYLES: Record<number, string> = {
  1: "text-yellow-400",
  2: "text-zinc-400",
  3: "text-amber-600",
};

export const PerformanceCard = memo(function PerformanceCard({
  performance: p,
  index,
  initialLiked = false,
  rank,
}: PerformanceCardProps) {
  const score = p.score ?? p.total_score ?? 0;
  const firstJury = p.jury_comments?.[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      className="relative rounded-2xl overflow-hidden border border-border bg-card/60 backdrop-blur-sm"
    >
      {p.album_image && (
        <div className="absolute inset-0 opacity-[0.07]">
          <Image
            src={p.album_image}
            alt=""
            fill
            className="object-cover"
            unoptimized
          />
        </div>
      )}

      <div className="relative p-4 space-y-3">
        {/* Header: name + score */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {rank && (
              <span
                className={`text-lg font-bold shrink-0 ${RANK_STYLES[rank] ?? "text-muted-foreground"}`}
              >
                #{rank}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">
                {p.display_name ?? "Anonyme"}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatRelativeTime(p.published_at ?? p.created_at)}
              </p>
            </div>
          </div>
          <div
            className={`px-2.5 py-1 rounded-full bg-gradient-to-r ${getScoreColor(score)} text-white text-xs font-bold shrink-0`}
          >
            {score}/100
          </div>
        </div>

        {/* Track info */}
        <Link
          href={
            p.spotify_track_id
              ? `/leaderboard/${p.spotify_track_id}`
              : `/results/${p.session_id}`
          }
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          {p.album_image && (
            <Image
              src={p.album_image}
              alt={p.track_name}
              width={40}
              height={40}
              className="rounded-lg shrink-0"
              unoptimized
            />
          )}
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{p.track_name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {p.artist_name}
            </p>
          </div>
        </Link>

        {/* Jury quote */}
        {firstJury && (
          <div className="p-2.5 rounded-lg bg-secondary/40 border border-border/40">
            <p className="text-xs font-medium text-gold-400 mb-0.5">
              {firstJury.persona}
            </p>
            <p className="text-xs text-muted-foreground italic line-clamp-2">
              &ldquo;{firstJury.comment}&rdquo;
            </p>
          </div>
        )}

        {/* Audio player */}
        {p.has_audio && (
          <InlineAudioPlayer
            mixUrl={p.audio_mix_url}
            vocalsUrl={p.audio_vocals_url}
          />
        )}

        {/* Footer: like + plays */}
        <div className="flex items-center justify-between">
          <LikeButton
            sessionId={p.session_id}
            initialCount={p.like_count}
            initialLiked={initialLiked}
          />
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Headphones className="w-3 h-3" />
            <span>{p.play_count}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
});
