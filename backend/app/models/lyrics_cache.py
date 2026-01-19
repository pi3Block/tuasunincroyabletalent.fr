"""
SQLAlchemy model for lyrics cache storage.
Stores lyrics data (synced and plain text) with TTL-based expiration.
"""
from datetime import datetime, timedelta
from sqlalchemy import Column, Integer, String, Text, DateTime, Index
from sqlalchemy.dialects.postgresql import JSONB

from app.models.lyrics_offset import Base


class LyricsCache(Base):
    """
    Caches lyrics data per Spotify track ID.

    Supports both synced lyrics (with timestamps) and plain text lyrics.
    Implements TTL-based expiration for cache invalidation.
    """
    __tablename__ = "lyrics_cache"

    id = Column(Integer, primary_key=True, index=True)

    # Primary key for lookup
    spotify_track_id = Column(String(255), nullable=False, unique=True, index=True)

    # Plain text lyrics (always stored for backward compatibility)
    lyrics_text = Column(Text, nullable=True)

    # Synced lyrics as JSON array: [{"text": "...", "startTimeMs": 0, "endTimeMs": 1000}, ...]
    synced_lines = Column(JSONB, nullable=True)

    # Metadata
    sync_type = Column(String(20), nullable=False, default='none')  # synced, unsynced, none
    source = Column(String(20), nullable=False, default='none')  # spotify, genius, none
    source_url = Column(Text, nullable=True)

    # Artist/title for debugging
    artist_name = Column(String(255), nullable=True)
    track_name = Column(String(255), nullable=True)

    # Cache management
    fetched_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    expires_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.utcnow() + timedelta(days=7)
    )

    __table_args__ = (
        Index('idx_lyrics_cache_expires', 'expires_at'),
        Index('idx_lyrics_cache_source', 'source'),
    )

    def __repr__(self) -> str:
        return f"<LyricsCache(track={self.spotify_track_id}, source={self.source}, sync_type={self.sync_type})>"

    @property
    def is_expired(self) -> bool:
        """Check if cache entry has expired."""
        if self.expires_at is None:
            return True
        return datetime.utcnow() > self.expires_at

    def to_dict(self) -> dict:
        """Convert to dictionary for API response."""
        has_lyrics = bool(self.lyrics_text) or bool(self.synced_lines)
        return {
            "spotify_track_id": self.spotify_track_id,
            "lyrics": self.lyrics_text or "",
            "lines": self.synced_lines,
            "syncType": self.sync_type,
            "source": self.source,
            "url": self.source_url,
            "status": "found" if has_lyrics else "not_found",
            "cachedAt": self.fetched_at.isoformat() if self.fetched_at else None,
        }
