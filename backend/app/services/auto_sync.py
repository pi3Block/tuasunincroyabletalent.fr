"""
Auto-sync service for automatic lyrics offset detection.

Uses cross-correlation between:
1. Whisper transcription of YouTube audio (first 30s)
2. Official lyrics timestamps

This provides an automatic offset suggestion without manual adjustment.
"""
import asyncio
from typing import Optional
import numpy as np

from app.config import settings
from app.services.redis_client import redis_client
from app.services.lyrics import lyrics_service
from app.services.lyrics_offset import lyrics_offset_service


class AutoSyncService:
    """
    Service for automatic lyrics synchronization.

    Uses audio transcription and text matching to calculate
    the optimal offset between YouTube video and lyrics.
    """

    # Configuration
    SAMPLE_DURATION_SECONDS = 30  # Analyze first 30 seconds
    MIN_CONFIDENCE_THRESHOLD = 0.5  # Minimum confidence to suggest offset
    MAX_OFFSET_SECONDS = 300  # Maximum offset to consider (±5 minutes)

    async def calculate_offset(
        self,
        session_id: str,
    ) -> dict:
        """
        Calculate automatic offset for a session.

        Algorithm:
        1. Get session info (YouTube audio path, track info)
        2. Transcribe first 30s of YouTube audio with Whisper
        3. Get synced lyrics (if available)
        4. Cross-correlate transcription timestamps with lyrics
        5. Return suggested offset with confidence score

        Args:
            session_id: Session ID

        Returns:
            dict with:
                - suggested_offset: Offset in seconds
                - confidence: Confidence score (0-1)
                - method: 'cross_correlation' or 'text_matching'
                - applied: Whether offset was auto-applied
                - error: Error message if failed
        """
        try:
            # Get session data
            session = await redis_client.get_session(session_id)
            if not session:
                return {
                    "suggested_offset": 0,
                    "confidence": 0,
                    "method": "none",
                    "applied": False,
                    "error": "Session not found",
                }

            spotify_track_id = session.get("spotify_track_id")
            youtube_id = session.get("youtube_id")
            reference_path = session.get("reference_path")
            artist_name = session.get("artist_name", "")
            track_name = session.get("track_name", "")
            album_name = session.get("album_name")
            duration_ms = session.get("duration_ms")

            if not reference_path:
                return {
                    "suggested_offset": 0,
                    "confidence": 0,
                    "method": "none",
                    "applied": False,
                    "error": "Reference audio not ready",
                }

            # Convert duration to seconds for LRCLib
            duration_sec = int(duration_ms / 1000) if duration_ms else None

            # Get lyrics with timestamps
            lyrics_data = await lyrics_service.get_lyrics(
                spotify_track_id=spotify_track_id,
                artist=artist_name,
                title=track_name,
                album=album_name,
                duration_sec=duration_sec,
            )

            synced_lines = lyrics_data.get("lines")
            if not synced_lines:
                # No synced lyrics - try text-based matching
                return await self._text_based_sync(
                    reference_path=reference_path,
                    lyrics_text=lyrics_data.get("lyrics", lyrics_data.get("text", "")),
                    spotify_track_id=spotify_track_id,
                    youtube_id=youtube_id,
                )

            # Cross-correlate with synced lyrics
            result = await self._cross_correlate_sync(
                reference_path=reference_path,
                synced_lines=synced_lines,
                spotify_track_id=spotify_track_id,
                youtube_id=youtube_id,
            )

            return result

        except Exception as e:
            print(f"[AutoSync] Error: {e}")
            return {
                "suggested_offset": 0,
                "confidence": 0,
                "method": "none",
                "applied": False,
                "error": str(e),
            }

    async def _cross_correlate_sync(
        self,
        reference_path: str,
        synced_lines: list[dict],
        spotify_track_id: str,
        youtube_id: str,
    ) -> dict:
        """
        Cross-correlate Whisper transcription with synced lyrics.

        Uses word-level timestamps from both sources to find optimal alignment.
        """
        try:
            # Transcribe first 30s of reference audio with word timestamps
            transcription = await self._transcribe_audio(
                audio_path=reference_path,
                duration=self.SAMPLE_DURATION_SECONDS,
            )

            if not transcription or not transcription.get("words"):
                return {
                    "suggested_offset": 0,
                    "confidence": 0,
                    "method": "cross_correlation",
                    "applied": False,
                    "error": "Transcription failed",
                }

            # Extract word timestamps from transcription
            transcribed_words = transcription["words"]

            # Extract word timestamps from synced lyrics (first 30s worth)
            lyrics_words = self._extract_lyrics_words(
                synced_lines,
                max_time_ms=self.SAMPLE_DURATION_SECONDS * 1000,
            )

            if not lyrics_words:
                return {
                    "suggested_offset": 0,
                    "confidence": 0,
                    "method": "cross_correlation",
                    "applied": False,
                    "error": "No lyrics words to match",
                }

            # Find matching words and calculate offset
            offset, confidence = self._calculate_offset_from_words(
                transcribed_words,
                lyrics_words,
            )

            # Store auto-calculated offset
            if confidence >= self.MIN_CONFIDENCE_THRESHOLD:
                await lyrics_offset_service.set_offset(
                    spotify_track_id=spotify_track_id,
                    youtube_video_id=youtube_id,
                    offset_seconds=offset,
                )

            return {
                "suggested_offset": offset,
                "confidence": confidence,
                "method": "cross_correlation",
                "applied": confidence >= self.MIN_CONFIDENCE_THRESHOLD,
            }

        except Exception as e:
            print(f"[AutoSync] Cross-correlation error: {e}")
            return {
                "suggested_offset": 0,
                "confidence": 0,
                "method": "cross_correlation",
                "applied": False,
                "error": str(e),
            }

    async def _text_based_sync(
        self,
        reference_path: str,
        lyrics_text: str,
        spotify_track_id: str,
        youtube_id: str,
    ) -> dict:
        """
        Fallback: Use text matching without timestamps.

        Transcribes audio and finds where lyrics text appears.
        Less accurate but works without synced lyrics.
        """
        try:
            # Transcribe first portion
            transcription = await self._transcribe_audio(
                audio_path=reference_path,
                duration=self.SAMPLE_DURATION_SECONDS,
            )

            if not transcription:
                return {
                    "suggested_offset": 0,
                    "confidence": 0,
                    "method": "text_matching",
                    "applied": False,
                    "error": "Transcription failed",
                }

            # Simple text matching - find first matching line
            transcribed_text = transcription.get("text", "").lower()
            lyrics_lines = [l.strip().lower() for l in lyrics_text.split("\n") if l.strip()]

            if not lyrics_lines:
                return {
                    "suggested_offset": 0,
                    "confidence": 0,
                    "method": "text_matching",
                    "applied": False,
                    "error": "No lyrics to match",
                }

            # Find first matching line
            first_line = lyrics_lines[0]
            words = transcription.get("words", [])

            # Look for the first few words of the first line
            first_words = first_line.split()[:3]
            search_text = " ".join(first_words)

            # Find in transcription
            match_time = None
            for i, word in enumerate(words):
                # Check if this starts a sequence matching our search
                if word.get("word", "").lower().startswith(first_words[0][:3]):
                    # Potential match - check next words
                    match_time = word.get("start", 0)
                    break

            if match_time is not None:
                # Offset = when lyrics should start (0) - when audio starts (match_time)
                offset = -match_time
                confidence = 0.4  # Lower confidence for text matching

                return {
                    "suggested_offset": round(offset, 2),
                    "confidence": confidence,
                    "method": "text_matching",
                    "applied": False,  # Don't auto-apply low confidence
                }

            return {
                "suggested_offset": 0,
                "confidence": 0,
                "method": "text_matching",
                "applied": False,
                "error": "No matching text found",
            }

        except Exception as e:
            print(f"[AutoSync] Text matching error: {e}")
            return {
                "suggested_offset": 0,
                "confidence": 0,
                "method": "text_matching",
                "applied": False,
                "error": str(e),
            }

    async def _transcribe_audio(
        self,
        audio_path: str,
        duration: int = 30,
    ) -> Optional[dict]:
        """
        Transcribe audio using Whisper with word-level timestamps.

        Args:
            audio_path: Path to audio file
            duration: Max duration to transcribe (seconds)

        Returns:
            dict with 'text' and 'words' (list of {word, start, end})
        """
        try:
            # Run Whisper in thread pool (it's CPU/GPU intensive)
            result = await asyncio.to_thread(
                self._run_whisper,
                audio_path,
                duration,
            )
            return result

        except Exception as e:
            print(f"[AutoSync] Whisper error: {e}")
            return None

    def _run_whisper(self, audio_path: str, duration: int) -> dict:
        """
        Run Whisper transcription (sync, called in thread).
        """
        try:
            import whisper

            # Load model (cached after first load)
            model = whisper.load_model("base")  # Use base for speed

            # Transcribe with word timestamps
            result = model.transcribe(
                audio_path,
                language="fr",  # French
                word_timestamps=True,
                fp16=False,  # Disable for CPU compatibility
            )

            # Extract word-level data
            words = []
            for segment in result.get("segments", []):
                # Stop if we've passed our duration limit
                if segment.get("start", 0) > duration:
                    break

                for word_data in segment.get("words", []):
                    if word_data.get("start", 0) <= duration:
                        words.append({
                            "word": word_data.get("word", "").strip(),
                            "start": word_data.get("start", 0),
                            "end": word_data.get("end", 0),
                        })

            return {
                "text": result.get("text", ""),
                "words": words,
            }

        except ImportError:
            print("[AutoSync] Whisper not installed")
            return {"text": "", "words": []}
        except Exception as e:
            print(f"[AutoSync] Whisper transcription error: {e}")
            return {"text": "", "words": []}

    def _extract_lyrics_words(
        self,
        synced_lines: list[dict],
        max_time_ms: int,
    ) -> list[dict]:
        """
        Extract word timestamps from synced lyrics lines.

        Since we only have line-level timestamps, we estimate word positions
        by distributing them evenly within each line's duration.
        """
        words = []

        for i, line in enumerate(synced_lines):
            start_ms = line.get("startTimeMs", 0)
            if start_ms > max_time_ms:
                break

            text = line.get("text", "")
            line_words = text.split()

            if not line_words:
                continue

            # Get end time (from next line or estimate)
            if line.get("endTimeMs"):
                end_ms = line["endTimeMs"]
            elif i + 1 < len(synced_lines):
                end_ms = synced_lines[i + 1].get("startTimeMs", start_ms + 3000)
            else:
                end_ms = start_ms + 3000  # Default 3 second line

            # Distribute words evenly
            duration_per_word = (end_ms - start_ms) / len(line_words)

            for j, word in enumerate(line_words):
                word_start = start_ms + (j * duration_per_word)
                word_end = word_start + duration_per_word

                words.append({
                    "word": word.lower(),
                    "start": word_start / 1000,  # Convert to seconds
                    "end": word_end / 1000,
                })

        return words

    def _calculate_offset_from_words(
        self,
        transcribed_words: list[dict],
        lyrics_words: list[dict],
    ) -> tuple[float, float]:
        """
        Calculate offset by matching words between transcription and lyrics.

        Returns:
            Tuple of (offset_seconds, confidence)
        """
        if not transcribed_words or not lyrics_words:
            return 0.0, 0.0

        # Normalize words for comparison
        trans_normalized = [
            {"word": w["word"].lower().strip(".,!?"), "start": w["start"]}
            for w in transcribed_words
            if w.get("word")
        ]

        lyrics_normalized = [
            {"word": w["word"].lower().strip(".,!?"), "start": w["start"]}
            for w in lyrics_words
            if w.get("word")
        ]

        # Find matching words and their time differences
        offsets = []

        for trans_word in trans_normalized:
            trans_text = trans_word["word"]
            trans_time = trans_word["start"]

            # Find matching word in lyrics
            for lyrics_word in lyrics_normalized:
                if lyrics_word["word"] == trans_text:
                    lyrics_time = lyrics_word["start"]
                    # Offset = lyrics_time - trans_time
                    # (positive = lyrics are ahead, need to delay)
                    offset = lyrics_time - trans_time
                    if abs(offset) <= self.MAX_OFFSET_SECONDS:
                        offsets.append(offset)
                    break  # Only match first occurrence

        if not offsets:
            return 0.0, 0.0

        # Calculate median offset (robust to outliers)
        median_offset = float(np.median(offsets))

        # Calculate confidence based on:
        # 1. Number of matches
        # 2. Consistency of offsets (low variance = high confidence)
        match_ratio = len(offsets) / max(len(trans_normalized), 1)
        offset_std = float(np.std(offsets)) if len(offsets) > 1 else 0

        # Confidence formula
        consistency_score = max(0, 1 - (offset_std / 5))  # Penalty for high variance
        coverage_score = min(1, match_ratio * 2)  # Bonus for many matches

        confidence = (consistency_score * 0.6 + coverage_score * 0.4)
        confidence = round(min(1.0, max(0.0, confidence)), 2)

        return round(median_offset, 2), confidence


# Singleton instance
auto_sync_service = AutoSyncService()
