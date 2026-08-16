#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import torch
from qwen_asr import Qwen3ASRModel


def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--language", default=None)
    parser.add_argument("--device", default="cuda:0")
    return parser.parse_args()


def normalize(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[\u3000\s]", "", text)
    return text


def edit_distance(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, char_a in enumerate(a, 1):
        current = [i]
        for j, char_b in enumerate(b, 1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[j] + 1,
                    previous[j - 1] + (char_a != char_b),
                )
            )
        previous = current
    return previous[-1]


def target_text(value: str) -> str:
    marker = "<asr_text>"
    return value.split(marker, 1)[1] if marker in value else value


def main() -> None:
    config = args()
    rows = [
        json.loads(line)
        for line in config.manifest.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not rows:
        raise RuntimeError(f"No samples in {config.manifest}")

    model = Qwen3ASRModel.from_pretrained(
        config.model,
        dtype=torch.bfloat16,
        device_map=config.device,
        max_inference_batch_size=1,
        max_new_tokens=512,
    )

    output_rows = []
    total_edits = 0
    total_chars = 0

    for index, row in enumerate(rows, 1):
        result = model.transcribe(audio=row["audio"], language=config.language)[0]
        reference = target_text(str(row["text"]))
        prediction = result.text
        ref_norm = normalize(reference)
        pred_norm = normalize(prediction)
        edits = edit_distance(ref_norm, pred_norm)
        total_edits += edits
        total_chars += max(1, len(ref_norm))
        output_rows.append(
            {
                "audio": row["audio"],
                "reference": reference,
                "prediction": prediction,
                "language": result.language,
                "edits": edits,
                "reference_chars": len(ref_norm),
            }
        )
        print(f"[{index}/{len(rows)}] CER={edits / max(1, len(ref_norm)):.4f}")

    config.output.parent.mkdir(parents=True, exist_ok=True)
    with config.output.open("w", encoding="utf-8") as handle:
        for row in output_rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"Corpus CER: {total_edits / max(1, total_chars):.4f}")


if __name__ == "__main__":
    main()
