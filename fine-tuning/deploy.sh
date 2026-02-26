#!/bin/bash
# Deploy fine-tuned jury models to Ollama Light (GPU 0, port 11435)
#
# Prerequisites:
#   1. Run train.py to create LoRA adapter
#   2. Run convert_to_gguf.py to export GGUF
#   3. Run this script to register models in Ollama
#
# Usage:
#   cd fine-tuning && bash deploy.sh

set -e

OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11435}"

echo "=== Creating Ollama models from fine-tuned GGUF ==="
echo "Ollama host: $OLLAMA_HOST"

echo ""
echo "Creating kiaraoke-jury-cassant..."
OLLAMA_HOST="$OLLAMA_HOST" ollama create kiaraoke-jury-cassant -f Modelfile.le-cassant

echo "Creating kiaraoke-jury-encourageant..."
OLLAMA_HOST="$OLLAMA_HOST" ollama create kiaraoke-jury-encourageant -f Modelfile.l-encourageant

echo "Creating kiaraoke-jury-technique..."
OLLAMA_HOST="$OLLAMA_HOST" ollama create kiaraoke-jury-technique -f Modelfile.le-technique

echo ""
echo "=== Models created ==="
OLLAMA_HOST="$OLLAMA_HOST" ollama list | grep kiaraoke-jury

echo ""
echo "=== Smoke test (Le Cassant) ==="
OLLAMA_HOST="$OLLAMA_HOST" ollama run kiaraoke-jury-cassant \
  "Score: 45/100, Justesse: 30%, Rythme: 50%, Paroles: 55%. Donne ton avis en 2 phrases."

echo ""
echo "Done! Set USE_FINETUNED_JURY=true in worker env to activate."
