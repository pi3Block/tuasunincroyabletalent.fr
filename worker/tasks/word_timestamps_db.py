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
                spotify_track_id, youtube_video_id, words, lines, source,
                language, model_version, confidence_avg, word_count, duration_ms,
                artist_name, track_name, created_at, expires_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            ON CONFLICT ON CONSTRAINT uq_word_timestamps_track_video
            DO UPDATE SET
                words = EXCLUDED.words,
                lines = EXCLUDED.lines,
                source = EXCLUDED.source,
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


def get_lyrics_for_alignment(
    spotify_track_id: str,
) -> tuple[str | None, list[dict] | None]:
    """
    Fetch existing lyrics from lyrics_cache for forced alignment.

    Returns:
        Tuple of (lyrics_text, synced_lines) or (None, None) if not found
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Fetch from lyrics_cache table
        # Column names: lyrics_text (plain text), synced_lines (JSONB array)
        cursor.execute("""
            SELECT lyrics_text, synced_lines, sync_type
            FROM lyrics_cache
            WHERE spotify_track_id = %s
            ORDER BY
                CASE sync_type
                    WHEN 'synced' THEN 1
                    WHEN 'unsynced' THEN 2
                    ELSE 3
                END
            LIMIT 1
        """, (spotify_track_id,))

        row = cursor.fetchone()
        cursor.close()
        conn.close()

        if not row:
            print(f"[WordTimestampsDB] No lyrics found for {spotify_track_id}")
            return None, None

        lyrics_text = row.get("lyrics_text")
        synced_lines_data = row.get("synced_lines")
        sync_type = row.get("sync_type")

        # Parse synced_lines if available
        synced_lines = None
        if synced_lines_data and sync_type == "synced":
            try:
                synced_lines = synced_lines_data if isinstance(synced_lines_data, list) else json.loads(synced_lines_data)
                # Extract text from synced lines to build lyrics_text if not available
                if not lyrics_text and synced_lines:
                    lyrics_text = "\n".join(
                        line.get("words", "") or line.get("text", "")
                        for line in synced_lines
                        if line.get("words") or line.get("text")
                    )
            except (json.JSONDecodeError, TypeError) as e:
                print(f"[WordTimestampsDB] Error parsing synced_lines: {e}")

        print(f"[WordTimestampsDB] Found lyrics for {spotify_track_id}: {len(lyrics_text or '')} chars, sync_type={sync_type}")
        return lyrics_text, synced_lines

    except Exception as e:
        print(f"[WordTimestampsDB] Error fetching lyrics: {e}")
        return None, None
