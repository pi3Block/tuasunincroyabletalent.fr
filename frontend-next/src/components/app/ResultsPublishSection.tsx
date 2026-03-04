"use client";

import { useState } from "react";
import { Share2, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublishModal } from "./PublishModal";
import Link from "next/link";

interface ResultsPublishSectionProps {
  sessionId: string;
  trackName: string;
  score: number;
  isPublic?: boolean;
  spotifyTrackId?: string;
}

export function ResultsPublishSection({
  sessionId,
  trackName,
  score,
  isPublic = false,
  spotifyTrackId,
}: ResultsPublishSectionProps) {
  const [showModal, setShowModal] = useState(false);
  const [published, setPublished] = useState(isPublic);
  const [displayName, setDisplayName] = useState("");

  if (published) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 text-green-400 text-sm">
          <Check className="w-4 h-4" />
          {displayName
            ? `Publie en tant que "${displayName}"`
            : "Publie dans le feed !"}
        </div>
        <div className="flex gap-3">
          <Link href="/discover">
            <Button variant="outline" size="sm">
              <ExternalLink className="w-4 h-4 mr-2" />
              Voir le feed
            </Button>
          </Link>
          {spotifyTrackId && (
            <Link href={`/leaderboard/${spotifyTrackId}`}>
              <Button variant="outline" size="sm">
                Classement
              </Button>
            </Link>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              navigator.share?.({
                url: window.location.href,
                title: trackName,
              })
            }
          >
            <Share2 className="w-4 h-4 mr-2" />
            Partager
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Button
        onClick={() => setShowModal(true)}
        className="bg-gradient-to-r from-primary to-emerald-500 text-primary-foreground font-bold"
      >
        <Share2 className="w-4 h-4 mr-2" />
        Partager ma performance
      </Button>
      {showModal && (
        <PublishModal
          sessionId={sessionId}
          trackName={trackName}
          score={score}
          onPublished={(name) => {
            setPublished(true);
            setDisplayName(name);
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
