"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Share2, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";

interface PublishModalProps {
  sessionId: string;
  trackName: string;
  score: number;
  onPublished: (displayName: string) => void;
  onClose: () => void;
}

export function PublishModal({
  sessionId,
  trackName,
  score,
  onPublished,
  onClose,
}: PublishModalProps) {
  const [name, setName] = useState("");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Entre ton pseudo");
      return;
    }
    if (trimmed.length > 64) {
      setError("Maximum 64 caracteres");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await api.publishPerformance(sessionId, {
        display_name: trimmed,
        include_audio: includeAudio,
      });
      onPublished(trimmed);
    } catch {
      setError("Erreur lors de la publication. Reessaie.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full max-w-md bg-card border border-border rounded-2xl p-6 space-y-4"
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Share2 className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-lg">Partager ta performance</h2>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-muted-foreground text-sm">
            Publie <strong>&quot;{trackName}&quot;</strong> ({score}/100) dans le
            feed public.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1">
                Ton pseudo
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: MusicFan42"
                maxLength={64}
                className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                autoFocus
              />
              {error && (
                <p className="text-red-400 text-xs mt-1">{error}</p>
              )}
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeAudio}
                onChange={(e) => setIncludeAudio(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm">
                Inclure l&apos;audio (mix + voix seule)
              </span>
            </label>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Publication...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Publier
                </>
              )}
            </Button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
