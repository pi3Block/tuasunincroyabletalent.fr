"""Initial schema — baseline from existing create_all() tables.

Revision ID: 001
Revises: None
Create Date: 2026-02-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # lyrics_offsets
    op.create_table(
        "lyrics_offsets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("spotify_track_id", sa.String(255), nullable=False),
        sa.Column("youtube_video_id", sa.String(32), nullable=False),
        sa.Column("offset_seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("spotify_track_id", "youtube_video_id", name="uq_lyrics_offset_track_video"),
    )
    op.create_index("idx_lyrics_offset_spotify", "lyrics_offsets", ["spotify_track_id"])

    # lyrics_cache
    op.create_table(
        "lyrics_cache",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("spotify_track_id", sa.String(255), nullable=False, unique=True, index=True),
        sa.Column("lyrics_text", sa.Text(), nullable=True),
        sa.Column("synced_lines", postgresql.JSONB(), nullable=True),
        sa.Column("sync_type", sa.String(20), nullable=False, server_default="none"),
        sa.Column("source", sa.String(20), nullable=False, server_default="none"),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("artist_name", sa.String(255), nullable=True),
        sa.Column("track_name", sa.String(255), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
    )
    op.create_index("idx_lyrics_cache_expires", "lyrics_cache", ["expires_at"])
    op.create_index("idx_lyrics_cache_source", "lyrics_cache", ["source"])

    # word_timestamps_cache
    op.create_table(
        "word_timestamps_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("spotify_track_id", sa.String(255), nullable=False),
        sa.Column("youtube_video_id", sa.String(32), nullable=True),
        sa.Column("words", postgresql.JSONB(), nullable=False),
        sa.Column("lines", postgresql.JSONB(), nullable=False),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("language", sa.String(10), nullable=True),
        sa.Column("model_version", sa.String(50), nullable=True),
        sa.Column("confidence_avg", sa.Numeric(4, 3), nullable=True),
        sa.Column("word_count", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("artist_name", sa.String(255), nullable=True),
        sa.Column("track_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("spotify_track_id", "youtube_video_id", name="uq_word_timestamps_track_video"),
    )
    op.create_index("idx_word_timestamps_spotify", "word_timestamps_cache", ["spotify_track_id"])
    op.create_index("idx_word_timestamps_youtube", "word_timestamps_cache", ["youtube_video_id"])
    op.create_index("idx_word_timestamps_lookup", "word_timestamps_cache", ["spotify_track_id", "youtube_video_id"])
    op.create_index("idx_word_timestamps_expires", "word_timestamps_cache", ["expires_at"])
    op.create_index("idx_word_timestamps_source", "word_timestamps_cache", ["source"])

    # session_results
    op.create_table(
        "session_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.String(64), unique=True, index=True, nullable=False),
        sa.Column("spotify_track_id", sa.String(64), nullable=False, index=True),
        sa.Column("youtube_video_id", sa.String(32), nullable=True),
        sa.Column("track_name", sa.String(255), nullable=True),
        sa.Column("artist_name", sa.String(255), nullable=True),
        sa.Column("album_image", sa.String(512), nullable=True),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("pitch_accuracy", sa.Numeric(5, 2), nullable=True),
        sa.Column("rhythm_accuracy", sa.Numeric(5, 2), nullable=True),
        sa.Column("lyrics_accuracy", sa.Numeric(5, 2), nullable=True),
        sa.Column("jury_comments", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("session_results")
    op.drop_table("word_timestamps_cache")
    op.drop_table("lyrics_cache")
    op.drop_table("lyrics_offsets")
