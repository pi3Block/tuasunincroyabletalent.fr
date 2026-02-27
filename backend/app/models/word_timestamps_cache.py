"""
SQLAlchemy model for word-level timestamps cache storage.
Stores word-by-word synchronized lyrics with timestamps for karaoke display.
"""
from datetime import datetime, timedelta, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, Index, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from app.models.lyrics_offset import Base


class WordTimestampsCache(Base):
    """
    Caches word-level timestamps for lyrics synchronization.

    Supports multiple sources:
    - musixmatch_word: Professional word-synced from Musixmatch/Spotify
    - whisper_timestamped: Generated via Whisper ASR on separated vocals
    - user_corrected: Manual corrections by users

    Key is composite: (spotify_track_id, youtube_video_id) to handle
    different video versions of the same track.
    """
    __tablename__ = "word_timestamps_cache"

    id = Column(Integer, primary_key=True, index=True)

    # Composite key for lookup
    spotify_track_id = Column(String(255), nullable=False, index=True)
    youtube_video_id = Column(String(32), nullable=True, index=True)  # Nullable for Musixmatch-only

    # Word-level data: [{word, startMs, endMs, confidence}, ...]
    words = Column(JSONB, nullable=False)

    # Line-level data for display: [{startMs, endMs, words: [...], text}, ...]
    lines = Column(JSONB, nullable=False)

    # Source metadata
    source = Column(String(50), nullable=False)  # musixmatch_word, whisper_timestamped, user_corrected
    language = Column(String(10), nullable=True)
    model_version = Column(String(50), nullable=True)  # e.g., 'whisper-turbo-1.0'

    # Quality metrics
    confidence_avg = Column(Numeric(4, 3), nullable=True)  # Average confidence score
    word_count = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)  # Total duration covered

    # Artist/title for debugging
    artist_name = Column(String(255), nullable=True)
    track_name = Column(String(255), nullable=True)

    # Cache management
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc) + timedelta(days=90),
    )

    __table_args__ = (
        # Unique constraint on the composite key
        UniqueConstraint('spotify_track_id', 'youtube_video_id', name='uq_word_timestamps_track_video'),
        Index('idx_word_timestamps_lookup', 'spotify_track_id', 'youtube_video_id'),
        Index('idx_word_timestamps_expires', 'expires_at'),
        Index('idx_word_timestamps_source', 'source'),
    )

    def __repr__(self) -> str:
        return f"<WordTimestampsCache(track={self.spotify_track_id}, video={self.youtube_video_id}, source={self.source})>"

    @property
    def is_expired(self) -> bool:
        """Check if cache entry has expired."""
        if self.expires_at is None:
            return True
        return datetime.now(timezone.utc) > self.expires_at

    @property
    def source_priority(self) -> int:
        """
        Get source priority for sorting (lower = better quality).
        Used when multiple sources are available.
        """
        priorities = {
            'user_corrected': 0,      # User corrections are highest priority
            'musixmatch_word': 1,     # Professional sync
            'whisper_timestamped': 2, # Generated
        }
        return priorities.get(self.source, 99)

    def to_dict(self) -> dict:
        """Convert to dictionary for API response."""
        return {
            "spotify_track_id": self.spotify_track_id,
            "youtube_video_id": self.youtube_video_id,
            "words": self.words,
            "lines": self.lines,
            "source": self.source,
            "language": self.language,
            "model_version": self.model_version,
            "confidence_avg": float(self.confidence_avg) if self.confidence_avg else None,
            "word_count": self.word_count,
            "duration_ms": self.duration_ms,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
        }

    def to_lyrics_response(self) -> dict:
        """Convert to lyrics API response format."""
        return {
            "syncType": "WORD_SYNCED",
            "words": self.words,
            "lines": self.lines,
            "source": self.source,
            "language": self.language,
            "quality": {
                "confidence": float(self.confidence_avg) if self.confidence_avg else None,
                "word_count": self.word_count,
                "source_priority": self.source_priority,
            }
        }
