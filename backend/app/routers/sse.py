"""
Server-Sent Events endpoint for real-time session updates.

Replaces frontend polling with push-based updates for:
- Session status (reference preparation: downloading -> ready)
- Analysis progress (pipeline steps: separating -> pitch -> scoring)
- Analysis completion/failure

Uses internal Redis polling at 500ms and only emits on state changes.
"""
import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from celery import Celery

from app.services.redis_client import redis_client
from app.config import settings

logger = logging.getLogger(__name__)

celery_app = Celery(
    "voicejury",
    broker=settings.redis_url,
    backend=settings.redis_url,
)
celery_app.conf.result_backend_transport_options = {"max_connections": 10}

router = APIRouter()

POLL_INTERVAL = 0.5  # 500ms internal Redis polling
HEARTBEAT_INTERVAL = 15  # Seconds between heartbeats
MAX_DURATION = 600  # 10 minutes max SSE connection


def _format_sse(event: str, data: dict) -> str:
    """Format a Server-Sent Event message."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _session_event_generator(session_id: str):
    """
    Async generator that yields SSE events for a session.

    Polls Redis every 500ms and only emits when state changes.
    Emits heartbeat every 15s to keep the connection alive through proxies.
    """
    elapsed = 0.0
    heartbeat_timer = 0.0
    last_ref_status = None
    last_analysis_status = None
    last_progress_step = None
    last_tracks_ready = None

    yield _format_sse("connected", {"session_id": session_id})

    while elapsed < MAX_DURATION:
        try:
            session = await redis_client.get_session(session_id)
            if not session:
                yield _format_sse("error", {"message": "Session not found"})
                return

            # --- Session status (reference preparation) ---
            current_ref_status = session.get("reference_status")
            if current_ref_status != last_ref_status:
                last_ref_status = current_ref_status
                yield _format_sse("session_status", {
                    "session_id": session_id,
                    "status": session.get("status", "unknown"),
                    "reference_status": current_ref_status,
                    "reference_ready": current_ref_status == "ready",
                    "track_name": session.get("track_name"),
                    "artist_name": session.get("artist_name"),
                    "error": session.get("error"),
                })

            # --- Tracks ready (ref stems from prepare_reference) ---
            tracks_ready_at = session.get("tracks_ready_at")
            if tracks_ready_at and tracks_ready_at != last_tracks_ready:
                last_tracks_ready = tracks_ready_at
                yield _format_sse("tracks_ready", {
                    "session_id": session_id,
                    "source": "ref",
                    "tracks": ["vocals", "instrumentals"],
                })

            # --- Analysis task progress ---
            task_id = session.get("analysis_task_id")
            if task_id:
                task_result = celery_app.AsyncResult(task_id)
                current_status = task_result.status

                # Progress step changes
                if current_status == "PROGRESS" and task_result.info:
                    progress = task_result.info
                    current_step = progress.get("step")
                    if current_step != last_progress_step:
                        last_progress_step = current_step
                        yield _format_sse("analysis_progress", {
                            "session_id": session_id,
                            "task_id": task_id,
                            "step": current_step,
                            "progress": progress.get("progress", 0),
                            "detail": progress.get("detail", ""),
                        })

                # Status transitions (SUCCESS / FAILURE)
                if current_status != last_analysis_status:
                    last_analysis_status = current_status

                    if current_status == "SUCCESS":
                        results = task_result.result
                        yield _format_sse("analysis_complete", {
                            "session_id": session_id,
                            "task_id": task_id,
                            "results": results,
                        })
                        # Persist and update session
                        try:
                            from app.routers.session import _persist_results
                            await _persist_results(session_id, session, results)
                        except Exception as persist_err:
                            logger.warning("SSE: failed to persist results: %s", persist_err)
                        await redis_client.update_session(session_id, {
                            "status": "completed",
                            "results": results,
                        })
                        return  # Done

                    elif current_status == "FAILURE":
                        yield _format_sse("analysis_error", {
                            "session_id": session_id,
                            "task_id": task_id,
                            "error": str(task_result.result),
                        })
                        await redis_client.update_session(session_id, {
                            "status": "error",
                            "error": str(task_result.result),
                        })
                        return  # Done

            # --- Heartbeat ---
            heartbeat_timer += POLL_INTERVAL
            if heartbeat_timer >= HEARTBEAT_INTERVAL:
                heartbeat_timer = 0
                yield _format_sse("heartbeat", {"elapsed": round(elapsed)})

        except asyncio.CancelledError:
            logger.debug("SSE connection cancelled for %s", session_id)
            return
        except Exception as e:
            logger.warning("SSE error for %s: %s", session_id, e)
            yield _format_sse("error", {"message": str(e)})

        await asyncio.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

    yield _format_sse("timeout", {"message": "SSE connection timed out after 10 minutes"})


@router.get("/{session_id}/stream")
async def stream_session_events(session_id: str):
    """
    SSE endpoint for real-time session updates.

    Events:
    - connected: Initial connection confirmation
    - session_status: Reference status changes
    - tracks_ready: Reference stems available for multi-track playback
    - analysis_progress: Pipeline step updates
    - analysis_complete: Final results
    - analysis_error: Pipeline failure
    - heartbeat: Keep-alive (every 15s)
    - timeout: Max duration reached

    Usage: const es = new EventSource('/api/session/{id}/stream')
    """
    session = await redis_client.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return StreamingResponse(
        _session_event_generator(session_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
