"""
SQLAlchemy model for persistent session results.
Stores analysis results (scores + jury comments) so they survive Redis expiration.
"""
from sqlalchemy import Column, Integer, String, Numeric, DateTime, Boolean, Text, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.models.lyrics_offset import Base


class SessionResult(Base):
    """
    Stores completed analysis results per session.

    Persisted in PostgreSQL so results survive Redis TTL expiration.
    Enables history, public feed, and per-song leaderboards.
    """
    __tablename__ = "session_results"

    id = Column(Integer, primary_key=True)
    session_id = Column(String(64), unique=True, index=True, nullable=False)
    spotify_track_id = Column(String(64), nullable=False, index=True)
    youtube_video_id = Column(String(32))
    track_name = Column(String(255))
    artist_name = Column(String(255))
    album_image = Column(String(512))
    score = Column(Integer)
    pitch_accuracy = Column(Numeric(5, 2))
    rhythm_accuracy = Column(Numeric(5, 2))
    lyrics_accuracy = Column(Numeric(5, 2))
    jury_comments = Column(JSONB)  # [{persona, comment, vote, model, latency_ms}]
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Social sharing columns
    display_name = Column(String(64), nullable=True)
    is_public = Column(Boolean, nullable=False, server_default="false", index=True)
    like_count = Column(Integer, nullable=False, server_default="0")
    play_count = Column(Integer, nullable=False, server_default="0")
    has_audio = Column(Boolean, nullable=False, server_default="false")
    audio_mix_url = Column(Text, nullable=True)
    audio_vocals_url = Column(Text, nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_session_results_spotify_score", "spotify_track_id", "score"),
    )

    def __repr__(self) -> str:
        return f"<SessionResult(session={self.session_id}, score={self.score})>"

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "spotify_track_id": self.spotify_track_id,
            "youtube_video_id": self.youtube_video_id,
            "track_name": self.track_name,
            "artist_name": self.artist_name,
            "album_image": self.album_image,
            "score": self.score,
            "total_score": self.score,  # frontend compat alias
            "pitch_accuracy": float(self.pitch_accuracy) if self.pitch_accuracy else None,
            "rhythm_accuracy": float(self.rhythm_accuracy) if self.rhythm_accuracy else None,
            "lyrics_accuracy": float(self.lyrics_accuracy) if self.lyrics_accuracy else None,
            "jury_comments": self.jury_comments,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "display_name": self.display_name,
            "is_public": self.is_public,
            "like_count": self.like_count,
            "play_count": self.play_count,
            "has_audio": self.has_audio,
            "audio_mix_url": self.audio_mix_url,
            "audio_vocals_url": self.audio_vocals_url,
            "published_at": self.published_at.isoformat() if self.published_at else None,
        }
