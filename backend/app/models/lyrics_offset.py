"""
SQLAlchemy model for lyrics offset storage.
Stores the timing offset between YouTube video and lyrics for each track/video pair.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Numeric, DateTime, UniqueConstraint, Index
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for SQLAlchemy models."""
    pass


class LyricsOffset(Base):
    """
    Stores lyrics timing offset for a Spotify track + YouTube video combination.

    Offset is in seconds (positive = lyrics appear earlier, negative = lyrics appear later).
    """
    __tablename__ = "lyrics_offsets"

    id = Column(Integer, primary_key=True, index=True)
    spotify_track_id = Column(String(255), nullable=False)
    youtube_video_id = Column(String(32), nullable=False)
    offset_seconds = Column(Numeric(5, 2), nullable=False, default=0.0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        UniqueConstraint('spotify_track_id', 'youtube_video_id', name='uq_lyrics_offset_track_video'),
        Index('idx_lyrics_offsets_lookup', 'spotify_track_id', 'youtube_video_id'),
    )

    def __repr__(self) -> str:
        return f"<LyricsOffset(track={self.spotify_track_id}, video={self.youtube_video_id}, offset={self.offset_seconds})>"
