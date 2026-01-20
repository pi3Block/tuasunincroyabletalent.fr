"""
Direct PostgreSQL access for word timestamps caching from worker.
This avoids importing backend modules which aren't available in the worker context.
"""
import os
import json
from datetime import datetime, timedelta
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor, Json


# PostgreSQL TTL by source (in days)
POSTGRES_TTL_WHISPER = 90


def get_db_connection():
    """Get a connection to PostgreSQL."""
    database_url = os.getenv("DATABASE_URL", "postgresql://voicejury:voicejury_secret@postgres:5432/voicejury")
    return psycopg2.connect(database_url)


def store_word_timestamps(
    spotify_track_id: str,
    youtube_video_id: str | None,
    words: list[dict],
    lines: list[dict],
    source: str,
    language: str | None = None,
    model_version: str | None = None,
    confidence_avg: float | None = None,
    artist_name: str | None = None,
    track_name: str | None = None,
) -> bool:
    """
    Store word timestamps directly in PostgreSQL.

    Args:
        spotify_track_id: Spotify track ID
        youtube_video_id: YouTube video ID
        words: List of word objects with timestamps
        lines: List of line objects with nested words
        source: Source identifier (e.g., 'whisper_timestamped')
        language: Language code
        model_version: Model version for tracking
        confidence_avg: Average confidence score
        artist_name: For debugging
        track_name: For debugging

    Returns:
        True if successful, False otherwise
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Calculate metadata
        word_count = len(words)
        duration_ms = max(w.get('endMs', 0) for w in words) if words else 0

        # Calculate expiry
        expires_at = datetime.utcnow() + timedelta(days=POSTGRES_TTL_WHISPER)

        # Check if table exists, create if not
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS word_timestamps_cache (
                id SERIAL PRIMARY KEY,
                spotify_track_id VARCHAR(64) NOT NULL,
                youtube_video_id VARCHAR(32),
                words JSONB NOT NULL,
                lines JSONB NOT NULL,
                source VARCHAR(32) NOT NULL,
                source_priority INTEGER NOT NULL DEFAULT 3,
                language VARCHAR(8),
                model_version VARCHAR(64),
                confidence_avg FLOAT,
                word_count INTEGER,
                duration_ms INTEGER,
                artist_name VARCHAR(256),
                track_name VARCHAR(256),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP WITH TIME ZONE,
                CONSTRAINT uq_word_timestamps_track_video UNIQUE (spotify_track_id, youtube_video_id)
            );
        """)

        # Upsert the data
        cursor.execute("""
            INSERT INTO word_timestamps_cache (
                spotify_track_id, youtube_video_id, words, lines, source, source_priority,
                language, model_version, confidence_avg, word_count, duration_ms,
                artist_name, track_name, created_at, expires_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            ON CONFLICT ON CONSTRAINT uq_word_timestamps_track_video
            DO UPDATE SET
                words = EXCLUDED.words,
                lines = EXCLUDED.lines,
                source = EXCLUDED.source,
                source_priority = EXCLUDED.source_priority,
                language = EXCLUDED.language,
                model_version = EXCLUDED.model_version,
                confidence_avg = EXCLUDED.confidence_avg,
                word_count = EXCLUDED.word_count,
                duration_ms = EXCLUDED.duration_ms,
                artist_name = EXCLUDED.artist_name,
                track_name = EXCLUDED.track_name,
                created_at = EXCLUDED.created_at,
                expires_at = EXCLUDED.expires_at
        """, (
            spotify_track_id,
            youtube_video_id,
            Json(words),
            Json(lines),
            source,
            3,  # source_priority for whisper
            language,
            model_version,
            confidence_avg,
            word_count,
            duration_ms,
            artist_name,
            track_name,
            datetime.utcnow(),
            expires_at,
        ))

        conn.commit()
        cursor.close()
        conn.close()

        print(f"[WordTimestampsDB] Stored {word_count} words for {spotify_track_id}")
        return True

    except Exception as e:
        print(f"[WordTimestampsDB] Error storing word timestamps: {e}")
        return False


def check_word_timestamps_exists(
    spotify_track_id: str,
    youtube_video_id: str | None = None,
) -> bool:
    """Check if word timestamps exist in cache."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        query = """
            SELECT 1 FROM word_timestamps_cache
            WHERE spotify_track_id = %s
            AND (expires_at IS NULL OR expires_at > %s)
        """
        params = [spotify_track_id, datetime.utcnow()]

        if youtube_video_id:
            query += " AND (youtube_video_id = %s OR youtube_video_id IS NULL)"
            params.append(youtube_video_id)

        cursor.execute(query, params)
        exists = cursor.fetchone() is not None

        cursor.close()
        conn.close()

        return exists

    except Exception as e:
        print(f"[WordTimestampsDB] Error checking existence: {e}")
        return False
