"""Social sharing — add publish/like columns to session_results, create performance_likes.

Revision ID: 002
Revises: 001
Create Date: 2026-03-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add social columns to session_results
    op.add_column("session_results", sa.Column("display_name", sa.String(64), nullable=True))
    op.add_column("session_results", sa.Column("is_public", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("session_results", sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("session_results", sa.Column("play_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("session_results", sa.Column("has_audio", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("session_results", sa.Column("audio_mix_url", sa.Text(), nullable=True))
    op.add_column("session_results", sa.Column("audio_vocals_url", sa.Text(), nullable=True))
    op.add_column("session_results", sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("idx_session_results_is_public", "session_results", ["is_public"])
    op.create_index("idx_session_results_spotify_score", "session_results", ["spotify_track_id", "score"])

    # Create performance_likes table
    op.create_table(
        "performance_likes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.String(64), nullable=False),
        sa.Column("fingerprint", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("session_id", "fingerprint", name="uq_performance_like"),
    )
    op.create_index("idx_performance_likes_session", "performance_likes", ["session_id"])


def downgrade() -> None:
    op.drop_table("performance_likes")
    op.drop_index("idx_session_results_spotify_score", table_name="session_results")
    op.drop_index("idx_session_results_is_public", table_name="session_results")
    for col in ["display_name", "is_public", "like_count", "play_count",
                "has_audio", "audio_mix_url", "audio_vocals_url", "published_at"]:
        op.drop_column("session_results", col)
