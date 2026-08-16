#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    out[key] = value;
  }
  return out;
}

function usage() {
  console.log(`DialectSeed dataset exporter

Usage:
  node scripts/export-dataset.mjs --api <url> --token <token> [options]

Options:
  --task asr|tts       Export task (default: asr)
  --variety <id>       Restrict export to one variety ID
  --out <directory>    Output directory (default: ./dataset-<task>)

Environment variables:
  DIALECTSEED_API_URL
  DIALECTSEED_ADMIN_TOKEN
`);
}

function speakerBucket(speakerId) {
  const hex = createHash("sha256").update(speakerId).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16) / 0xffffffff;
}

function assignSplits(items) {
  const speakers = [...new Set(items.map((item) => item.speaker_id).filter(Boolean))];
  if (speakers.length < 10) {
    return new Map(speakers.map((speaker) => [speaker, "train"]));
  }
  return new Map(
    speakers.map((speaker) => {
      const value = speakerBucket(speaker);
      const split = value < 0.1 ? "test" : value < 0.2 ? "validation" : "train";
      return [speaker, split];
    })
  );
}

function extensionFrom(item) {
  const fromKey = extname(item.r2_key || "");
  if (fromKey) return fromKey;
  if ((item.mime_type || "").includes("wav")) return ".wav";
  if ((item.mime_type || "").includes("mpeg")) return ".mp3";
  if ((item.mime_type || "").includes("mp4")) return ".m4a";
  if ((item.mime_type || "").includes("ogg")) return ".ogg";
  return ".webm";
}

const args = parseArgs(process.argv.slice(2));
if (args.help === "true" || args.h === "true") {
  usage();
  process.exit(0);
}

const api = (args.api || process.env.DIALECTSEED_API_URL || "").replace(/\/$/, "");
const token = args.token || process.env.DIALECTSEED_ADMIN_TOKEN || "";
const task = args.task === "tts" ? "tts" : "asr";
const outDir = args.out || `./dataset-${task}`;

if (!api || !token) {
  usage();
  throw new Error("Both API URL and admin token are required");
}

const params = new URLSearchParams({ task });
if (args.variety) params.set("varietyId", args.variety);

const response = await fetch(`${api}/api/admin/export?${params.toString()}`, {
  headers: { Authorization: `Bearer ${token}` }
});
if (!response.ok) {
  throw new Error(`Manifest request failed (${response.status}): ${await response.text()}`);
}

const payload = await response.json();
const items = payload.items || [];
const splitBySpeaker = assignSplits(items);

await mkdir(join(outDir, "audio"), { recursive: true });
const lines = [];

for (let index = 0; index < items.length; index += 1) {
  const item = items[index];
  const extension = extensionFrom(item);
  const fileName = `${String(item.recording_id).padStart(8, "0")}${extension}`;
  const relativeAudio = `audio/${fileName}`;
  const audioUrl = new URL(item.audio_url, `${api}/`).toString();

  const audioResponse = await fetch(audioUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!audioResponse.ok) {
    throw new Error(`Audio download failed for recording ${item.recording_id} (${audioResponse.status})`);
  }

  await writeFile(join(outDir, relativeAudio), Buffer.from(await audioResponse.arrayBuffer()));
  lines.push(JSON.stringify({
    audio: relativeAudio,
    text: item.text,
    reference_text: item.reference_text,
    speaker_id: item.speaker_id,
    speaker_label: item.speaker_label,
    variety_id: item.variety_id,
    variety_slug: item.variety_slug,
    variety_name: item.variety_name,
    language_tag: item.language_tag,
    duration_ms: item.duration_ms,
    recording_id: item.recording_id,
    split: splitBySpeaker.get(item.speaker_id) || "train",
    task
  }));

  process.stdout.write(`\rDownloaded ${index + 1}/${items.length}`);
}

await writeFile(join(outDir, "metadata.jsonl"), lines.join("\n") + (lines.length ? "\n" : ""));
process.stdout.write("\n");
console.log(`Wrote ${items.length} item(s) to ${outDir}`);
