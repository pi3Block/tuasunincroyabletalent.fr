"""
Application configuration using Pydantic Settings.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Database
    database_url: str = "postgresql://voicejury:voicejury_secret@localhost:5432/voicejury"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Ollama
    ollama_host: str = "http://localhost:11434"

    # Spotify
    spotify_client_id: str = ""
    spotify_client_secret: str = ""
    # Spotify sp_dc cookie for synced lyrics (optional, from browser session)
    spotify_sp_dc: str = ""

    # Genius (Lyrics)
    genius_api_client_access_token: str = ""

    # Lyrics Cache
    lyrics_cache_ttl: int = 604800  # 7 days in seconds

    # App
    secret_key: str = "dev-secret-key-change-in-production"
    debug: bool = True

    # Audio
    audio_upload_dir: str = "/app/audio_files"
    max_audio_duration: int = 300  # 5 minutes max


settings = Settings()
