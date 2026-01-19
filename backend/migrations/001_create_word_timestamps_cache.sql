-- Migration: Create word_timestamps_cache table
-- Version: 001
-- Date: 2026-01-19
-- Description: Creates the table for caching word-level timestamps for karaoke display

-- Create the word_timestamps_cache table
CREATE TABLE IF NOT EXISTS word_timestamps_cache (
    id SERIAL PRIMARY KEY,

    -- Composite key for lookup
    spotify_track_id VARCHAR(255) NOT NULL,
    youtube_video_id VARCHAR(32),  -- Nullable for Musixmatch-only entries

    -- Word-level data: [{word, startMs, endMs, confidence}, ...]
    words JSONB NOT NULL,

    -- Line-level data for display: [{startMs, endMs, words: [...], text}, ...]
    lines JSONB NOT NULL,

    -- Source metadata
    source VARCHAR(50) NOT NULL,  -- musixmatch_word, whisper_timestamped, user_corrected
    language VARCHAR(10),
    model_version VARCHAR(50),  -- e.g., 'whisper-turbo-1.0'

    -- Quality metrics
    confidence_avg NUMERIC(4, 3),  -- Average confidence score (0.000 - 1.000)
    word_count INTEGER,
    duration_ms INTEGER,  -- Total duration covered

    -- Artist/title for debugging
    artist_name VARCHAR(255),
    track_name VARCHAR(255),

    -- Cache management
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Create unique constraint for composite key
ALTER TABLE word_timestamps_cache
ADD CONSTRAINT uq_word_timestamps_track_video
UNIQUE (spotify_track_id, youtube_video_id);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_word_timestamps_spotify
ON word_timestamps_cache(spotify_track_id);

CREATE INDEX IF NOT EXISTS idx_word_timestamps_youtube
ON word_timestamps_cache(youtube_video_id);

CREATE INDEX IF NOT EXISTS idx_word_timestamps_lookup
ON word_timestamps_cache(spotify_track_id, youtube_video_id);

CREATE INDEX IF NOT EXISTS idx_word_timestamps_expires
ON word_timestamps_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_word_timestamps_source
ON word_timestamps_cache(source);

-- Add comments for documentation
COMMENT ON TABLE word_timestamps_cache IS 'Caches word-level timestamps for karaoke display';
COMMENT ON COLUMN word_timestamps_cache.spotify_track_id IS 'Spotify track ID for cache key';
COMMENT ON COLUMN word_timestamps_cache.youtube_video_id IS 'YouTube video ID, nullable for Musixmatch entries';
COMMENT ON COLUMN word_timestamps_cache.words IS 'Array of word objects with timestamps: [{word, startMs, endMs, confidence}]';
COMMENT ON COLUMN word_timestamps_cache.lines IS 'Array of line objects with nested words for display';
COMMENT ON COLUMN word_timestamps_cache.source IS 'Source: musixmatch_word, whisper_timestamped, user_corrected';
COMMENT ON COLUMN word_timestamps_cache.confidence_avg IS 'Average word confidence score from Whisper';
COMMENT ON COLUMN word_timestamps_cache.expires_at IS 'TTL: 365 days for Musixmatch, 90 days for Whisper, NULL for user_corrected';
