"""SQLAlchemy model for anonymous performance likes (fingerprint-based dedup)."""
from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint, Index
from sqlalchemy.sql import func

from app.models.lyrics_offset import Base


class PerformanceLike(Base):
    __tablename__ = "performance_likes"

    id = Column(Integer, primary_key=True)
    session_id = Column(String(64), nullable=False)
    fingerprint = Column(String(128), nullable=False)  # SHA256(IP + User-Agent)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("session_id", "fingerprint", name="uq_performance_like"),
        Index("idx_performance_likes_session", "session_id"),
    )
