#!/usr/bin/env python3
"""Convert a DialectSeed export into model-specific training manifests.

The script deliberately uses ffmpeg as the audio boundary. Browser uploads can be
webm/ogg/mp4/etc.; training code should see one predictable WAV format instead.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--format", choices=("qwen3-asr", "voxcpm"), required=True)
    parser.add_argument("--input", type=Path, required=True, help="DialectSeed metadata.jsonl")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--language",
        default="auto",
        help="Qwen language prefix. Use auto, None, Cantonese, Chinese, English, etc.",
    )
    parser.add_argument(
        "--ref-probability",
        type=float,
        default=0.4,
        help="VoxCPM probability of attaching another same-speaker clip as ref_audio.",
    )
    parser.add_argument("--seed", type=int, default=20260816)
    return parser.parse_args()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON on line {line_no}: {exc}") from exc
        if not row.get("audio") or not row.get("text"):
            raise ValueError(f"Line {line_no} is missing audio or text")
        rows.append(row)
    return rows


def stable_name(row: dict[str, Any], suffix: str = ".wav") -> str:
    key = str(row.get("recording_id") or row.get("audio"))
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]
    rid = str(row.get("recording_id") or "sample")
    return f"{rid}-{digest}{suffix}"


def run_ffmpeg(source: Path, target: Path, sample_rate: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-c:a",
        "pcm_s16le",
        str(target),
    ]
    subprocess.run(command, check=True)


def resolve_audio(metadata_path: Path, value: str) -> Path:
    source = Path(value)
    if not source.is_absolute():
        source = metadata_path.parent / source
    if not source.exists():
        raise FileNotFoundError(source)
    return source.resolve()


def language_for(row: dict[str, Any], requested: str) -> str:
    if requested != "auto":
        return requested
    tag = str(row.get("language_tag") or "").lower()
    name = str(row.get("variety_name") or "").lower()
    slug = str(row.get("variety_slug") or "").lower()
    joined = " ".join((tag, name, slug))
    if tag.startswith("yue") or "cantonese" in joined:
        return "Cantonese"
    if tag.startswith("zh") or "chinese" in joined:
        return "Chinese"
    if tag.startswith("en") or "english" in joined:
        return "English"
    return "None"


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def prepare_qwen(rows: list[dict[str, Any]], metadata_path: Path, out: Path, language: str) -> None:
    converted: dict[str, Path] = {}
    manifests: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for row in rows:
        source = resolve_audio(metadata_path, str(row["audio"]))
        target = out / "audio" / stable_name(row)
        key = str(source)
        if key not in converted:
            run_ffmpeg(source, target, sample_rate=16_000)
            converted[key] = target.resolve()
        lang = language_for(row, language)
        manifests[str(row.get("split") or "train")].append(
            {
                "audio": str(converted[key]),
                "text": f"language {lang}<asr_text>{str(row['text']).strip()}",
            }
        )

    write_jsonl(out / "train.jsonl", manifests.get("train", []))
    write_jsonl(out / "validation.jsonl", manifests.get("validation", []))
    write_jsonl(out / "test.jsonl", manifests.get("test", []))


def prepare_voxcpm(
    rows: list[dict[str, Any]],
    metadata_path: Path,
    out: Path,
    ref_probability: float,
    seed: int,
) -> None:
    rng = random.Random(seed)
    converted: dict[str, Path] = {}
    prepared: list[dict[str, Any]] = []

    for row in rows:
        source = resolve_audio(metadata_path, str(row["audio"]))
        target = out / "audio" / stable_name(row)
        key = str(source)
        if key not in converted:
            run_ffmpeg(source, target, sample_rate=44_100)
            converted[key] = target.resolve()
        prepared.append({**row, "_wav": str(converted[key])})

    by_split_speaker: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in prepared:
        split = str(row.get("split") or "train")
        speaker = str(row.get("speaker_id") or "")
        if speaker:
            by_split_speaker[(split, speaker)].append(row)

    manifests: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in prepared:
        split = str(row.get("split") or "train")
        speaker = str(row.get("speaker_id") or "")
        item: dict[str, Any] = {
            "audio": row["_wav"],
            "text": str(row["text"]).strip(),
            "dataset_id": 0,
        }
        duration_ms = row.get("duration_ms")
        if isinstance(duration_ms, (int, float)) and duration_ms > 0:
            item["duration"] = float(duration_ms) / 1000.0

        candidates = [
            candidate
            for candidate in by_split_speaker.get((split, speaker), [])
            if candidate.get("_wav") != row.get("_wav")
        ]
        if candidates and rng.random() < max(0.0, min(1.0, ref_probability)):
            ref = rng.choice(candidates)
            item["ref_audio"] = ref["_wav"]
            ref_duration_ms = ref.get("duration_ms")
            if isinstance(ref_duration_ms, (int, float)) and ref_duration_ms > 0:
                item["ref_duration"] = float(ref_duration_ms) / 1000.0

        manifests[split].append(item)

    write_jsonl(out / "train.jsonl", manifests.get("train", []))
    write_jsonl(out / "validation.jsonl", manifests.get("validation", []))
    write_jsonl(out / "test.jsonl", manifests.get("test", []))


def main() -> None:
    args = parse_args()
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is required but was not found on PATH")
    rows = load_jsonl(args.input.resolve())
    args.output.mkdir(parents=True, exist_ok=True)

    if args.format == "qwen3-asr":
        prepare_qwen(rows, args.input.resolve(), args.output.resolve(), args.language)
    else:
        prepare_voxcpm(
            rows,
            args.input.resolve(),
            args.output.resolve(),
            args.ref_probability,
            args.seed,
        )

    print(f"Prepared {len(rows)} samples in {args.output.resolve()}")


if __name__ == "__main__":
    main()
