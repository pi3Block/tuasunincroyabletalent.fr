"""
Export jury comment training data from Langfuse traces.

Queries Langfuse API for all jury-comment generations, extracts
input prompts and output comments, and exports to JSONL files
per persona suitable for fine-tuning.

Usage:
    python export_dataset.py --output-dir ./data
    python export_dataset.py --output-dir ./data --limit 500
"""
import os
import json
import argparse
import logging
from pathlib import Path

import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PERSONAS = ["Le Cassant", "L'Encourageant", "Le Technique"]

LANGFUSE_BASE_URL = os.getenv("LANGFUSE_BASE_URL", "http://langfuse:3000")
LANGFUSE_PUBLIC_KEY = os.getenv("LANGFUSE_PUBLIC_KEY", "")
LANGFUSE_SECRET_KEY = os.getenv("LANGFUSE_SECRET_KEY", "")


def fetch_generations(limit: int = 1000) -> list[dict]:
    """Fetch all jury-comment generations from Langfuse API."""
    generations = []
    page = 1

    while len(generations) < limit:
        response = httpx.get(
            f"{LANGFUSE_BASE_URL}/api/public/generations",
            params={
                "name": "jury-comment",
                "limit": 100,
                "page": page,
            },
            auth=(LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY),
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()

        batch = data.get("data", [])
        if not batch:
            break

        generations.extend(batch)
        page += 1
        logger.info("Fetched page %d (%d total)", page - 1, len(generations))

    return generations[:limit]


def to_training_example(gen: dict) -> dict | None:
    """Convert a Langfuse generation to a chat-format training example."""
    input_text = gen.get("input", "")
    output_text = gen.get("output", "")
    metadata = gen.get("metadata", {})

    if not input_text or not output_text:
        return None

    # Skip heuristic-generated outputs (not LLM quality)
    if gen.get("model", "") == "heuristic":
        return None

    persona = metadata.get("persona", "")
    if persona not in PERSONAS:
        return None

    # Filter low-quality outputs
    if len(output_text) < 20:
        return None

    return {
        "persona": persona,
        "messages": [
            {
                "role": "system",
                "content": f'Tu es "{persona}", un jury de concours de chant.',
            },
            {"role": "user", "content": input_text},
            {"role": "assistant", "content": output_text},
        ],
    }


def export(output_dir: Path, generations: list[dict]) -> dict:
    """Export training data as JSONL files per persona + combined."""
    output_dir.mkdir(parents=True, exist_ok=True)

    per_persona: dict[str, list] = {p: [] for p in PERSONAS}
    all_examples = []

    for gen in generations:
        example = to_training_example(gen)
        if example:
            per_persona[example["persona"]].append(example)
            all_examples.append(example)

    # Write per-persona files
    for persona, examples in per_persona.items():
        slug = persona.lower().replace(" ", "-").replace("'", "")
        filepath = output_dir / f"train_{slug}.jsonl"
        with open(filepath, "w", encoding="utf-8") as f:
            for ex in examples:
                f.write(json.dumps(ex, ensure_ascii=False) + "\n")
        logger.info("%s: %d examples -> %s", persona, len(examples), filepath)

    # Write combined file
    combined_path = output_dir / "train_all.jsonl"
    with open(combined_path, "w", encoding="utf-8") as f:
        for ex in all_examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    stats = {
        "total": len(all_examples),
        "per_persona": {p: len(ex) for p, ex in per_persona.items()},
    }
    stats_path = output_dir / "stats.json"
    with open(stats_path, "w") as f:
        json.dump(stats, f, indent=2)

    logger.info("Total: %d examples -> %s", len(all_examples), combined_path)
    return stats


def main():
    parser = argparse.ArgumentParser(description="Export Langfuse jury data for fine-tuning")
    parser.add_argument("--output-dir", default="./data", help="Output directory")
    parser.add_argument("--limit", type=int, default=1000, help="Max generations to fetch")
    args = parser.parse_args()

    logger.info("Fetching generations from %s ...", LANGFUSE_BASE_URL)
    generations = fetch_generations(limit=args.limit)
    logger.info("Fetched %d generations", len(generations))

    stats = export(Path(args.output_dir), generations)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
