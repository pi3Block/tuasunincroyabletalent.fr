"""
Persistent results routes.
Serves historical performance data from PostgreSQL.
"""
from fastapi import APIRouter

from app.services.database import get_db
from app.models.session_results import SessionResult
from sqlalchemy import select

router = APIRouter()


@router.get("/history")
async def get_results_history(limit: int = 20):
    """
    Get recent performance results from PostgreSQL.

    Returns the latest results for the landing page "Recent Performances" section.
    """
    limit = min(limit, 50)

    async with get_db() as db:
        query = (
            select(SessionResult)
            .order_by(SessionResult.created_at.desc())
            .limit(limit)
        )
        result = await db.execute(query)
        rows = result.scalars().all()

    return {"results": [r.to_dict() for r in rows]}
