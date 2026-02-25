"""
SQLAlchemy model for persistent session results.
Stores analysis results (scores + jury comments) so they survive Redis expiration.
"""
from sqlalchemy import Column, Integer, String, Numeric, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.models.lyrics_offset import Base


class SessionResult(Base):
    """
    Stores completed analysis results per session.

    Persisted in PostgreSQL so results survive Redis TTL expiration.
    Enables history endpoint for recent performances.
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

    def __repr__(self) -> str:
        return f"<SessionResult(session={self.session_id}, score={self.score})>"

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "spotify_track_id": self.spotify_track_id,
            "track_name": self.track_name,
            "artist_name": self.artist_name,
            "album_image": self.album_image,
            "score": self.score,
            "pitch_accuracy": float(self.pitch_accuracy) if self.pitch_accuracy else None,
            "rhythm_accuracy": float(self.rhythm_accuracy) if self.rhythm_accuracy else None,
            "lyrics_accuracy": float(self.lyrics_accuracy) if self.lyrics_accuracy else None,
            "jury_comments": self.jury_comments,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
