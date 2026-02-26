"""
QLoRA fine-tuning of Qwen3:4b for Kiaraoke jury personas.

Uses Unsloth for 4-bit quantized training on RTX 3070 8GB.
Trains a single LoRA adapter on all persona data — persona identity
is encoded in the system prompt of each training example.

Usage:
    python train.py --data-dir ./data --output-dir ./output
    python train.py --data-dir ./data --output-dir ./output --epochs 5 --lr 1e-4
"""
import argparse
from pathlib import Path

import torch
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

BASE_MODEL = "Qwen/Qwen3-4B"
MAX_SEQ_LENGTH = 2048
LORA_R = 16
LORA_ALPHA = 32
LORA_DROPOUT = 0.05


def main(args):
    print(f"Loading {BASE_MODEL} with 4-bit quantization...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=BASE_MODEL,
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,  # Auto-detect (float16/bfloat16)
        load_in_4bit=True,
    )

    print(f"Adding LoRA adapters (r={LORA_R}, alpha={LORA_ALPHA})...")
    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_R,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        bias="none",
        use_gradient_checkpointing="unsloth",
    )

    # Load dataset
    data_file = str(Path(args.data_dir) / "train_all.jsonl")
    print(f"Loading dataset from {data_file}...")
    dataset = load_dataset("json", data_files=data_file, split="train")
    print(f"Dataset: {len(dataset)} examples")

    # Format as chat template
    def format_chat(example):
        text = tokenizer.apply_chat_template(
            example["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": text}

    dataset = dataset.map(format_chat)

    # Training
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Training for {args.epochs} epochs (lr={args.lr})...")
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=MAX_SEQ_LENGTH,
        args=TrainingArguments(
            output_dir=str(output_dir),
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            warmup_steps=10,
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            fp16=not torch.cuda.is_bf16_supported(),
            bf16=torch.cuda.is_bf16_supported(),
            logging_steps=10,
            save_strategy="epoch",
            optim="adamw_8bit",
        ),
    )

    trainer.train()

    # Save LoRA adapter
    adapter_path = output_dir / "lora_adapter"
    model.save_pretrained(str(adapter_path))
    tokenizer.save_pretrained(str(adapter_path))
    print(f"LoRA adapter saved to {adapter_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QLoRA fine-tuning for jury personas")
    parser.add_argument("--data-dir", default="./data")
    parser.add_argument("--output-dir", default="./output")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--lr", type=float, default=2e-4)
    args = parser.parse_args()
    main(args)
