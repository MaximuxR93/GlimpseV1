"""
Glimpse — backend server
=========================
Handles the Reddit search proxy so the browser extension
never hits Reddit directly (which would be blocked by CORS).

Run with:
    uvicorn main:app --reload

For production, deploy to Railway / Render / Fly.io and update
BACKEND_URL in Sidebar.tsx to your deployed URL.
"""

import httpx
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Glimpse", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # Extension can run on any page origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────

class RedditPost(BaseModel):
    title: str
    score: int
    url: str
    snippet: str


# ─────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────

@app.get("/")
def home():
    return {
        "product": "Glimpse",
        "version": "2.1.0",
        "status": "running",
        "endpoints": ["/health", "/reddit/search"],
    }


@app.get("/health")
def health():
    return {"status": "ok"}


# ─────────────────────────────────────────────
# REDDIT PROXY
# Browsers can't call Reddit directly — CORS blocks it.
# This endpoint runs server-side where CORS doesn't apply.
# ─────────────────────────────────────────────

REDDIT_HEADERS = {
    # Reddit requires a descriptive User-Agent for API access.
    # Format: <platform>:<app_id>:<version> (by /u/<username>)
    "User-Agent": "web:com.glimpse.extension:2.1.0 (by /u/glimpse_ext)",
    "Accept": "application/json",
}

@app.get("/reddit/search", response_model=list[RedditPost])
async def reddit_search(
    q: str = Query(..., min_length=3, max_length=300, description="Search query / claim text"),
    limit: int = Query(default=6, ge=1, le=10),
):
    """
    Proxy Reddit's public search API.
    Returns top posts matching the query, sorted by relevance.
    No Reddit API key required — uses the public unauthenticated endpoint.
    """
    url = "https://www.reddit.com/search.json"
    params = {
        "q": q,
        "sort": "relevance",
        "limit": limit,
        "type": "link",
        "raw_json": 1,
    }

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, params=params, headers=REDDIT_HEADERS)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Reddit search timed out.")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Reddit: {e}")

    if resp.status_code == 429:
        raise HTTPException(
            status_code=429,
            detail="Reddit rate limit hit. Wait a moment and try again.",
        )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Reddit returned {resp.status_code}.",
        )

    try:
        data = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Reddit returned non-JSON response.")

    posts: list[dict] = data.get("data", {}).get("children", [])

    results: list[RedditPost] = []
    for child in posts:
        p = child.get("data", {})
        title = (p.get("title") or "").strip()
        if not title:
            continue
        results.append(
            RedditPost(
                title=title,
                score=int(p.get("score") or 0),
                url=f"https://reddit.com{p.get('permalink', '/r/all')}",
                snippet=(p.get("selftext") or title).strip()[:400],
            )
        )

    return results