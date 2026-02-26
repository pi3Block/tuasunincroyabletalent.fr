"""
Langfuse Tracing for Voicejury Worker.

Adapted from augmenter.pro/worker/tasks/curation_scoring/tracing.py.

Provides:
- get_langfuse_client() — thread-safe singleton
- flush_traces() — call at task end
- trace_pipeline() — context manager for full analysis pipeline
- trace_jury_comment() — context manager for each LLM jury call

Usage:
    from .tracing import trace_pipeline, trace_jury_comment, flush_traces

    with trace_pipeline(session_id="abc", song_title="Bohemian Rhapsody") as pipeline_span:
        # ... pipeline steps ...
        with trace_jury_comment(pipeline_span, persona="Le Cassant", model="qwen3:4b") as gen:
            result = call_ollama(...)
            gen.update(output=result, usage={"total_tokens": 150})

    flush_traces()
"""

import os
import logging
import threading
from typing import Any, Optional
from contextlib import contextmanager
from datetime import datetime

logger = logging.getLogger(__name__)

# =============================================================================
# LANGFUSE CLIENT SINGLETON
# =============================================================================

_langfuse_client = None
_client_lock = threading.Lock()


def get_langfuse_client():
    """
    Get Langfuse client singleton.
    Returns None if not configured.

    Environment variables (Langfuse v3):
    - LANGFUSE_PUBLIC_KEY: Required API public key
    - LANGFUSE_SECRET_KEY: Required API secret key
    - LANGFUSE_BASE_URL: Required for self-hosted (e.g., http://langfuse:3000)
    """
    global _langfuse_client

    with _client_lock:
        if _langfuse_client is not None:
            return _langfuse_client

        public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
        secret_key = os.getenv("LANGFUSE_SECRET_KEY")
        base_url = os.getenv("LANGFUSE_BASE_URL") or os.getenv("LANGFUSE_HOST")

        if not public_key or not secret_key:
            logger.debug("Langfuse not configured (missing credentials)")
            return None

        try:
            from langfuse import get_client
            _langfuse_client = get_client()
            if _langfuse_client and _langfuse_client.auth_check():
                logger.info("Langfuse tracing initialized (base_url=%s)", base_url)
            return _langfuse_client
        except Exception as e:
            logger.warning("Failed to init Langfuse: %s", e)
            return None


def flush_traces():
    """Flush pending traces to Langfuse (call at task end)."""
    client = get_langfuse_client()
    if client:
        try:
            client.flush()
        except Exception as e:
            logger.debug("Langfuse flush failed: %s", e)


# =============================================================================
# SPAN WRAPPER
# =============================================================================

class TracingSpan:
    """
    Wrapper for Langfuse span/generation tracking.
    Provides a simplified interface for voicejury operations.
    """

    def __init__(
        self,
        trace_id: Optional[str] = None,
        _span: Any = None,
        _trace: Any = None,
    ):
        self.trace_id = trace_id
        self._span = _span
        self._trace = _trace
        self.start_time = datetime.now()

    @property
    def trace(self):
        return self._trace

    def span(self, name: str, **kwargs) -> "TracingSpan":
        """Create a child span under this trace/span."""
        if self._trace is None:
            return TracingSpan()

        try:
            child = self._trace.span(name=name, **kwargs)
            return TracingSpan(
                trace_id=self.trace_id,
                _span=child,
                _trace=self._trace,
            )
        except Exception as e:
            logger.debug("Failed to create child span: %s", e)
            return TracingSpan()

    def generation(self, name: str, model: str = None, input: Any = None, **kwargs) -> "TracingSpan":
        """Create a generation span for LLM calls."""
        if self._trace is None:
            return TracingSpan()

        try:
            gen = self._trace.generation(
                name=name,
                model=model,
                input=input,
                **kwargs,
            )
            return TracingSpan(
                trace_id=self.trace_id,
                _span=gen,
                _trace=self._trace,
            )
        except Exception as e:
            logger.debug("Failed to create generation: %s", e)
            return TracingSpan()

    def update(
        self,
        output: Any = None,
        usage: Optional[dict] = None,
        model: Optional[str] = None,
        metadata: Optional[dict] = None,
        level: str = "DEFAULT",
    ):
        """Update span with output and metadata."""
        if self._span is None:
            return

        try:
            update_data = {"level": level}

            if output is not None:
                output_str = str(output)
                if len(output_str) > 5000:
                    output_str = output_str[:5000] + "...[truncated]"
                update_data["output"] = output_str

            if usage:
                update_data["usage_details"] = usage

            if model:
                update_data["model"] = model

            latency_ms = (datetime.now() - self.start_time).total_seconds() * 1000
            update_data["metadata"] = {
                "latency_ms": round(latency_ms, 2),
                **(metadata or {}),
            }

            self._span.update(**update_data)

        except Exception as e:
            logger.debug("Failed to update span: %s", e)

    def end(self):
        """End the span."""
        if self._span:
            try:
                self._span.end()
            except Exception as e:
                logger.debug("Failed to end span: %s", e)


# =============================================================================
# CONTEXT MANAGERS
# =============================================================================

@contextmanager
def trace_pipeline(
    session_id: str,
    song_title: str = "",
    artist_name: str = "",
    has_gpu: bool = False,
    youtube_id: Optional[str] = None,
    task_id: Optional[str] = None,
):
    """
    Context manager for tracing a full analysis pipeline.

    Yields:
        TracingSpan with .span() and .generation() for child operations.

    Example:
        with trace_pipeline(session_id="abc", song_title="Song") as pipeline:
            with trace_jury_comment(pipeline, persona="Le Cassant") as gen:
                ...
    """
    client = get_langfuse_client()

    if not client:
        yield TracingSpan()
        return

    try:
        trace = client.trace(
            name="voicejury.analyze_performance",
            session_id=f"session:{session_id}",
            tags=["project:voicejury", "voicejury", "pipeline", "tier:gpu-heavy"],
            metadata={
                "session_id": session_id,
                "song_title": song_title,
                "artist_name": artist_name,
                "has_gpu": has_gpu,
                "youtube_id": youtube_id,
                "task_id": task_id,
            },
        )

        span = TracingSpan(
            trace_id=trace.id if hasattr(trace, "id") else None,
            _trace=trace,
        )

        yield span

        client.flush()

    except Exception as e:
        logger.warning("Langfuse pipeline tracing error: %s", e)
        yield TracingSpan()


@contextmanager
def trace_jury_comment(
    pipeline_span: TracingSpan,
    persona_name: str,
    model: Optional[str] = None,
    prompt: Optional[str] = None,
):
    """
    Context manager for tracing a single jury LLM call.

    Args:
        pipeline_span: Parent pipeline trace
        persona_name: Jury persona name (e.g., "Le Cassant")
        model: LLM model name
        prompt: Input prompt (truncated if >2000 chars)

    Yields:
        TracingSpan with update() and end() methods.
    """
    if pipeline_span._trace is None:
        yield TracingSpan()
        return

    try:
        prompt_input = prompt[:2000] + "..." if prompt and len(prompt) > 2000 else prompt

        gen = pipeline_span._trace.generation(
            name=f"jury-comment-{persona_name.lower().replace(' ', '-')}",
            model=model,
            input=prompt_input,
            metadata={
                "persona": persona_name,
                "provider": "groq" if model and "groq" in model.lower() else "ollama",
            },
        )

        span = TracingSpan(
            trace_id=pipeline_span.trace_id,
            _span=gen,
            _trace=pipeline_span._trace,
        )

        yield span

        span.end()

    except Exception as e:
        logger.warning("Langfuse jury tracing error: %s", e)
        yield TracingSpan()
