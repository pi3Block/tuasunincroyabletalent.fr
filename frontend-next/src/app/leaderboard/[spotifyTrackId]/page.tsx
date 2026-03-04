import type { Metadata } from "next";
import { LeaderboardClient } from "./LeaderboardClient";
import type { LeaderboardResponse } from "@/api/client";

interface Props {
  params: Promise<{ spotifyTrackId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { spotifyTrackId } = await params;
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL || "https://api.kiaraoke.fr";
  try {
    const res = await fetch(
      `${apiUrl}/api/results/leaderboard/${spotifyTrackId}?limit=1`,
      { next: { revalidate: 300 } },
    );
    if (res.ok) {
      const data = (await res.json()) as LeaderboardResponse;
      const first = data.entries?.[0];
      if (first) {
        return {
          title: `Classement - ${first.track_name} | Kiaraoke`,
          description: `Qui chante le mieux "${first.track_name}" de ${first.artist_name} ? Classement Kiaraoke.`,
        };
      }
    }
  } catch {
    /* fallback */
  }
  return { title: "Classement | Kiaraoke" };
}

export default async function LeaderboardPage({ params }: Props) {
  const { spotifyTrackId } = await params;
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL || "https://api.kiaraoke.fr";

  let initial: LeaderboardResponse | null = null;
  try {
    const res = await fetch(
      `${apiUrl}/api/results/leaderboard/${spotifyTrackId}?period=all&limit=20`,
      { next: { revalidate: 60 } },
    );
    if (res.ok) initial = await res.json();
  } catch {
    /* fallback */
  }

  return (
    <LeaderboardClient spotifyTrackId={spotifyTrackId} initial={initial} />
  );
}
