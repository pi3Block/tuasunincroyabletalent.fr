"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";

interface LikeButtonProps {
  sessionId: string;
  initialCount: number;
  initialLiked: boolean;
  className?: string;
}

export function LikeButton({
  sessionId,
  initialCount,
  initialLiked,
  className,
}: LikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);

  const toggle = async () => {
    if (pending) return;
    const willLike = !liked;
    setLiked(willLike);
    setCount((c) => c + (willLike ? 1 : -1));
    setPending(true);
    try {
      if (willLike) await api.likePerformance(sessionId);
      else await api.unlikePerformance(sessionId);
    } catch {
      setLiked(!willLike);
      setCount((c) => c + (willLike ? -1 : 1));
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={pending}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all",
        liked
          ? "bg-red-500/20 border border-red-500/50 text-red-400"
          : "bg-secondary border border-border text-muted-foreground hover:text-foreground",
        className,
      )}
      aria-label={liked ? "Je n'aime plus" : "J'aime"}
    >
      <Heart
        className={cn(
          "w-4 h-4 transition-transform",
          liked && "fill-red-400 scale-110",
        )}
      />
      <span>{count}</span>
    </button>
  );
}
