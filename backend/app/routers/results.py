"""
Results retrieval routes.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class JuryComment(BaseModel):
    """Individual jury member comment."""
    persona: str
    comment: str
    vote: str  # "yes" | "no"


class SessionResults(BaseModel):
    """Complete session results."""
    session_id: str
    score: int
    pitch_accuracy: float
    rhythm_accuracy: float
    lyrics_accuracy: float
    feedback: str
    jury_comments: list[JuryComment]


@router.get("/{session_id}", response_model=SessionResults)
async def get_results(session_id: str):
    """
    Get evaluation results for a session.

    Returns scores and jury AI comments.
    """
    # TODO: Fetch from database

    # Mock response for now
    return SessionResults(
        session_id=session_id,
        score=72,
        pitch_accuracy=0.68,
        rhythm_accuracy=0.82,
        lyrics_accuracy=0.75,
        feedback="Tu as du potentiel, mais travaille ta justesse !",
        jury_comments=[
            JuryComment(
                persona="Le Cassant",
                comment="Le rythme c'est bien, mais les notes... on dirait un chat qu'on égorge !",
                vote="no",
            ),
            JuryComment(
                persona="L'Encourageant",
                comment="J'ai vu pire ! Avec un peu de travail, tu pourrais vraiment progresser.",
                vote="yes",
            ),
            JuryComment(
                persona="Le Technique",
                comment="Ton vibrato est intéressant, mais attention aux transitions entre les notes.",
                vote="yes",
            ),
        ],
    )
