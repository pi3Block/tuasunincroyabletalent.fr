"""
Service for managing lyrics offset settings.
Stores and retrieves timing offsets per (spotify_track_id, youtube_video_id) pair.
"""
from decimal import Decimal

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert

from app.services.database import get_db
from app.models.lyrics_offset import LyricsOffset


class LyricsOffsetService:
    """Service for CRUD operations on lyrics offsets."""

    async def get_offset(self, spotify_track_id: str, youtube_video_id: str) -> float:
        """
        Get stored offset for a track/video pair.
        Returns 0.0 if not found.

        Args:
            spotify_track_id: Spotify track ID
            youtube_video_id: YouTube video ID

        Returns:
            Offset in seconds (positive = lyrics earlier)
        """
        async with get_db() as session:
            result = await session.execute(
                select(LyricsOffset.offset_seconds).where(
                    LyricsOffset.spotify_track_id == spotify_track_id,
                    LyricsOffset.youtube_video_id == youtube_video_id,
                )
            )
            row = result.scalar_one_or_none()
            return float(row) if row is not None else 0.0

    async def set_offset(
        self,
        spotify_track_id: str,
        youtube_video_id: str,
        offset_seconds: float,
    ) -> float:
        """
        Save or update offset for a track/video pair.
        Uses UPSERT for atomic operation.

        Args:
            spotify_track_id: Spotify track ID
            youtube_video_id: YouTube video ID
            offset_seconds: Offset in seconds (clamped to -300 to +300)

        Returns:
            The saved offset value
        """
        # Clamp to reasonable range (±5 minutes)
        offset_seconds = max(-300.0, min(300.0, offset_seconds))

        async with get_db() as session:
            stmt = insert(LyricsOffset).values(
                spotify_track_id=spotify_track_id,
                youtube_video_id=youtube_video_id,
                offset_seconds=Decimal(str(round(offset_seconds, 2))),
            ).on_conflict_do_update(
                constraint='uq_track_video',
                set_={
                    'offset_seconds': Decimal(str(round(offset_seconds, 2))),
                    'updated_at': func.now(),
                }
            )
            await session.execute(stmt)

        return offset_seconds

    async def reset_offset(self, spotify_track_id: str, youtube_video_id: str) -> None:
        """Reset offset to 0.0."""
        await self.set_offset(spotify_track_id, youtube_video_id, 0.0)


# Singleton instance
lyrics_offset_service = LyricsOffsetService()
