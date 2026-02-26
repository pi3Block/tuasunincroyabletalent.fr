"""
Convert fine-tuned LoRA adapter to GGUF for Ollama deployment.

Merges LoRA weights into base model and exports to GGUF Q4_K_M
quantization via Unsloth's built-in converter.

Usage:
    python convert_to_gguf.py
    python convert_to_gguf.py --adapter-dir ./output/lora_adapter --output ./gguf
"""
import argparse
from pathlib import Path

from unsloth import FastLanguageModel


def main(args):
    adapter_dir = Path(args.adapter_dir)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading model with LoRA adapter from {adapter_dir}...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=str(adapter_dir),
        max_seq_length=2048,
        load_in_4bit=True,
    )

    output_name = str(output_dir / "kiaraoke-jury")
    print(f"Exporting to GGUF Q4_K_M -> {output_name}...")
    model.save_pretrained_gguf(
        output_name,
        tokenizer,
        quantization_method="q4_k_m",
    )

    print(f"GGUF model saved to {output_dir}")
    print("Next: create Ollama models with deploy.sh")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert LoRA to GGUF")
    parser.add_argument("--adapter-dir", default="./output/lora_adapter")
    parser.add_argument("--output", default="./gguf")
    args = parser.parse_args()
    main(args)
