export interface Env {
  DB: D1Database;
  AUDIO_BUCKET: R2Bucket;
  ADMIN_TOKEN: string;
  IP_HASH_SALT?: string;
  ALLOWED_ORIGINS?: string;
}

type JsonValue = Record<string, unknown> | unknown[];

function json(data: JsonValue, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function allowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (!origin) return "*";
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowed.length) return origin;
  const ok = allowed.some((rule) => {
    if (rule === origin) return true;
    if (!rule.includes("*")) return false;
    const pattern = `^${rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*", ".*")}$`;
    return new RegExp(pattern).test(origin);
  });
  return ok ? origin : "null";
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(request, env),
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    Vary: "Origin"
  };
}

function withCors(response: Response, request: Request, env: Env) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) {
    if (value !== undefined) headers.set(key, String(value));
  }
  return new Response(response.body, { status: response.status, headers });
}

function isAdmin(request: Request, env: Env) {
  const auth = request.headers.get("Authorization") || "";
  return Boolean(env.ADMIN_TOKEN) && auth === `Bearer ${env.ADMIN_TOKEN}`;
}

function requireAdmin(request: Request, env: Env) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401);
  return null;
}

function integer(value: string | null, fallback = 0) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slugify(value: string) {
  const base = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || `variety-${crypto.randomUUID().slice(0, 8)}`;
}

async function hashIp(request: Request, env: Env) {
  if (!env.IP_HASH_SALT) return null;
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;
  const bytes = new TextEncoder().encode(`${env.IP_HASH_SALT}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function publicVarieties(env: Env) {
  const result = await env.DB.prepare(
    `SELECT id, slug, name, language_tag, region, description, status
     FROM varieties WHERE status = 'active' ORDER BY name COLLATE NOCASE`
  ).all();
  return json({ varieties: result.results || [] });
}

async function requestVariety(request: Request, env: Env) {
  const body = await request.json<Record<string, unknown>>().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (name.length < 2 || name.length > 100) return json({ error: "A valid variety name is required" }, 400);
  const region = String(body.region || "").trim() || null;
  const languageTag = String(body.languageTag || "").trim() || null;
  const description = String(body.description || "").trim() || null;
  let slug = slugify(name);
  const exists = await env.DB.prepare("SELECT id FROM varieties WHERE slug = ?").bind(slug).first();
  if (exists) slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;
  const result = await env.DB.prepare(
    `INSERT INTO varieties (slug, name, language_tag, region, description, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'pending', 'user') RETURNING id, slug, name, status`
  ).bind(slug, name, languageTag, region, description).first();
  return json({ variety: result }, 201);
}

async function publicTexts(url: URL, env: Env) {
  const varietyId = integer(url.searchParams.get("varietyId"));
  if (!varietyId) return json({ error: "varietyId is required" }, 400);
  const limit = Math.min(Math.max(integer(url.searchParams.get("limit"), 5), 1), 20);
  const result = await env.DB.prepare(
    `SELECT id, variety_id, content, reference_text, local_text, source
     FROM texts
     WHERE variety_id = ? AND status = 'active'
     ORDER BY RANDOM() LIMIT ?`
  ).bind(varietyId, limit).all();
  return json({ texts: result.results || [] });
}

async function createRecording(request: Request, env: Env) {
  const form = await request.formData();
  const textId = integer(String(form.get("textId") || ""));
  const varietyId = integer(String(form.get("varietyId") || ""));
  const durationMs = integer(String(form.get("durationMs") || ""));
  const speakerId = String(form.get("speakerId") || "").trim();
  const speakerLabel = String(form.get("speakerLabel") || "").trim() || null;
  const transcriptText = String(form.get("transcriptText") || "").trim();
  const consentArchive = String(form.get("consentArchive") || "0") === "1" ? 1 : 0;
  const consentTraining = String(form.get("consentTraining") || "0") === "1" ? 1 : 0;
  const consentVersion = String(form.get("consentVersion") || "2026-08-16").trim();
  const audio = form.get("audio");

  if (!textId || !varietyId) return json({ error: "textId and varietyId are required" }, 400);
  if (!speakerId || speakerId.length > 128) return json({ error: "A valid speakerId is required" }, 400);
  if (!transcriptText || transcriptText.length > 2000) return json({ error: "A spoken transcript is required" }, 400);
  if (!consentArchive) return json({ error: "Archival consent is required" }, 400);
  if (!(audio instanceof File) || !audio.size) return json({ error: "Audio file is required" }, 400);
  if (audio.size > 25 * 1024 * 1024) return json({ error: "Audio file is too large" }, 413);

  const prompt = await env.DB.prepare(
    `SELECT t.id, t.variety_id, COALESCE(t.reference_text, t.content) AS reference_text
     FROM texts t JOIN varieties v ON v.id = t.variety_id
     WHERE t.id = ? AND t.variety_id = ? AND t.status = 'active' AND v.status = 'active'`
  ).bind(textId, varietyId).first<{ id: number; variety_id: number; reference_text: string }>();
  if (!prompt) return json({ error: "Prompt not found for this active variety" }, 404);

  const safeType = audio.type || "application/octet-stream";
  const extension = safeType.includes("mp4") ? "m4a" : safeType.includes("ogg") ? "ogg" : safeType.includes("wav") ? "wav" : safeType.includes("mpeg") ? "mp3" : "webm";
  const r2Key = `recordings/${varietyId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
  await env.AUDIO_BUCKET.put(r2Key, audio.stream(), {
    httpMetadata: { contentType: safeType },
    customMetadata: { speakerId, consentVersion }
  });

  try {
    const result = await env.DB.prepare(
      `INSERT INTO recordings (
        text_id, variety_id, r2_key, mime_type, size_bytes, duration_ms,
        speaker_id, speaker_label, consent_archive, consent_training, consent_version,
        reference_text_snapshot, transcript_text_snapshot, status, user_agent, ip_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      RETURNING id, status`
    ).bind(
      textId, varietyId, r2Key, safeType, audio.size, durationMs || null,
      speakerId, speakerLabel, consentArchive, consentTraining, consentVersion,
      prompt.reference_text, transcriptText,
      request.headers.get("User-Agent"), await hashIp(request, env)
    ).first();
    return json(result || { status: "pending" }, 201);
  } catch (error) {
    await env.AUDIO_BUCKET.delete(r2Key);
    throw error;
  }
}

async function adminVarieties(url: URL, env: Env) {
  const status = url.searchParams.get("status");
  const filter = status ? "WHERE v.status = ?" : "";
  const sql = `SELECT v.*,
      (SELECT COUNT(*) FROM texts t WHERE t.variety_id = v.id) AS text_count,
      (SELECT COUNT(*) FROM recordings r WHERE r.variety_id = v.id) AS recording_count
    FROM varieties v ${filter} ORDER BY v.created_at DESC`;
  const statement = env.DB.prepare(sql);
  const result = status ? await statement.bind(status).all() : await statement.all();
  return json({ varieties: result.results || [] });
}

async function createAdminVariety(request: Request, env: Env) {
  const body = await request.json<Record<string, unknown>>().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (name.length < 2) return json({ error: "Name is required" }, 400);
  let slug = slugify(String(body.slug || name));
  if (await env.DB.prepare("SELECT id FROM varieties WHERE slug = ?").bind(slug).first()) {
    slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;
  }
  const item = await env.DB.prepare(
    `INSERT INTO varieties (slug, name, language_tag, region, description, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'active', 'admin') RETURNING *`
  ).bind(
    slug,
    name,
    String(body.languageTag || "").trim() || null,
    String(body.region || "").trim() || null,
    String(body.description || "").trim() || null
  ).first();
  return json({ variety: item }, 201);
}

async function setVarietyStatus(id: number, request: Request, env: Env) {
  const body = await request.json<Record<string, unknown>>().catch(() => ({}));
  const status = String(body.status || "");
  if (!["pending", "active", "archived"].includes(status)) return json({ error: "Invalid variety status" }, 400);
  const result = await env.DB.prepare("UPDATE varieties SET status = ? WHERE id = ? RETURNING *").bind(status, id).first();
  if (!result) return json({ error: "Variety not found" }, 404);
  return json({ variety: result });
}

async function adminTexts(url: URL, env: Env) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const varietyId = integer(url.searchParams.get("varietyId"));
  const source = url.searchParams.get("source");
  const q = url.searchParams.get("q")?.trim();
  if (varietyId) { conditions.push("t.variety_id = ?"); values.push(varietyId); }
  if (source) { conditions.push("t.source = ?"); values.push(source); }
  if (q) { conditions.push("(t.content LIKE ? OR t.reference_text LIKE ? OR t.local_text LIKE ?)"); values.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(integer(url.searchParams.get("limit"), 100), 1), 500);
  const statement = env.DB.prepare(
    `SELECT t.*, v.name AS variety_name,
      (SELECT COUNT(*) FROM recordings r WHERE r.text_id = t.id) AS recording_count
     FROM texts t JOIN varieties v ON v.id = t.variety_id
     ${where} ORDER BY t.created_at DESC LIMIT ?`
  ).bind(...values, limit);
  const rows = await statement.all();
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS count FROM texts t ${where}`).bind(...values).first<{ count: number }>();
  return json({ texts: rows.results || [], total: totalRow?.count || 0 });
}

async function createText(request: Request, env: Env) {
  const body = await request.json<Record<string, unknown>>().catch(() => ({}));
  const varietyId = Number(body.varietyId || 0);
  const referenceText = String(body.referenceText || "").trim();
  const localText = String(body.localText || "").trim() || null;
  const source = body.source === "user" ? "user" : "seed";
  if (!varietyId || referenceText.length < 2) return json({ error: "varietyId and referenceText are required" }, 400);
  const promptKey = `${varietyId}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const result = await env.DB.prepare(
    `INSERT INTO texts (variety_id, content, reference_text, local_text, source, prompt_key, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active') RETURNING *`
  ).bind(varietyId, referenceText, referenceText, localText, source, promptKey).first();
  return json({ text: result }, 201);
}

async function deleteText(id: number, env: Env) {
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM recordings WHERE text_id = ?").bind(id).first<{ count: number }>();
  if ((count?.count || 0) > 0) return json({ error: "Prompts with recordings cannot be deleted" }, 409);
  const result = await env.DB.prepare("DELETE FROM texts WHERE id = ? RETURNING id").bind(id).first();
  if (!result) return json({ error: "Prompt not found" }, 404);
  return json({ deleted: true });
}

async function adminRecordings(url: URL, env: Env) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const status = url.searchParams.get("status");
  const varietyId = integer(url.searchParams.get("varietyId"));
  const speaker = url.searchParams.get("speaker")?.trim();
  const q = url.searchParams.get("q")?.trim();
  const trainingOnly = url.searchParams.get("trainingOnly") === "1";
  if (status) { conditions.push("r.status = ?"); values.push(status); }
  if (varietyId) { conditions.push("r.variety_id = ?"); values.push(varietyId); }
  if (speaker) { conditions.push("(r.speaker_id LIKE ? OR r.speaker_label LIKE ?)"); values.push(`%${speaker}%`, `%${speaker}%`); }
  if (q) { conditions.push("(r.transcript_text_snapshot LIKE ? OR r.reference_text_snapshot LIKE ? OR r.r2_key LIKE ?)"); values.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (trainingOnly) conditions.push("r.status = 'approved' AND r.consent_training = 1 AND trim(COALESCE(r.transcript_text_snapshot, '')) <> ''");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(integer(url.searchParams.get("limit"), 100), 1), 500);
  const rows = await env.DB.prepare(
    `SELECT r.*, v.name AS variety_name, t.source
     FROM recordings r
     JOIN varieties v ON v.id = r.variety_id
     JOIN texts t ON t.id = r.text_id
     ${where} ORDER BY r.created_at DESC LIMIT ?`
  ).bind(...values, limit).all();
  const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM recordings r ${where}`).bind(...values).first<{ count: number }>();
  return json({ recordings: rows.results || [], total: count?.count || 0 });
}

async function setRecordingStatus(id: number, request: Request, env: Env) {
  const body = await request.json<Record<string, unknown>>().catch(() => ({}));
  const status = String(body.status || "");
  if (!["pending", "approved", "rejected"].includes(status)) return json({ error: "Invalid recording status" }, 400);
  const result = await env.DB.prepare("UPDATE recordings SET status = ? WHERE id = ? RETURNING id, status").bind(status, id).first();
  if (!result) return json({ error: "Recording not found" }, 404);
  return json(result as Record<string, unknown>);
}

async function deleteRecording(id: number, env: Env) {
  const item = await env.DB.prepare("SELECT r2_key FROM recordings WHERE id = ?").bind(id).first<{ r2_key: string }>();
  if (!item) return json({ error: "Recording not found" }, 404);
  await env.AUDIO_BUCKET.delete(item.r2_key);
  await env.DB.prepare("DELETE FROM recordings WHERE id = ?").bind(id).run();
  return json({ deleted: true });
}

async function recordingAudio(id: number, env: Env) {
  const row = await env.DB.prepare("SELECT r2_key, mime_type FROM recordings WHERE id = ?").bind(id).first<{ r2_key: string; mime_type: string }>();
  if (!row) return json({ error: "Recording not found" }, 404);
  const object = await env.AUDIO_BUCKET.get(row.r2_key);
  if (!object) return json({ error: "Audio object not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", row.mime_type || headers.get("Content-Type") || "application/octet-stream");
  headers.set("Cache-Control", "private, no-store");
  return new Response(object.body, { headers });
}

async function exportManifest(url: URL, env: Env) {
  const task = url.searchParams.get("task") === "tts" ? "tts" : "asr";
  const varietyId = integer(url.searchParams.get("varietyId"));
  const varietyFilter = varietyId ? "AND r.variety_id = ?" : "";
  const statement = env.DB.prepare(
    `SELECT
       r.id AS recording_id, r.r2_key, r.mime_type, r.duration_ms,
       r.speaker_id, r.speaker_label, r.variety_id,
       v.slug AS variety_slug, v.name AS variety_name, v.language_tag,
       r.transcript_text_snapshot AS text,
       r.reference_text_snapshot AS reference_text
     FROM recordings r JOIN varieties v ON v.id = r.variety_id
     WHERE r.status = 'approved'
       AND r.consent_training = 1
       AND trim(COALESCE(r.transcript_text_snapshot, '')) <> ''
       ${varietyFilter}
     ORDER BY r.id`
  );
  const result = varietyId ? await statement.bind(varietyId).all() : await statement.all();
  const items = (result.results || []).map((row) => ({
    ...row,
    task,
    audio_url: `/api/admin/recordings/${row.recording_id}/audio`
  }));
  return json({ task, count: items.length, items });
}

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  if (path === "/api/health" && request.method === "GET") return json({ ok: true, service: "DialectSeed" });
  if (path === "/api/varieties" && request.method === "GET") return publicVarieties(env);
  if (path === "/api/varieties" && request.method === "POST") return requestVariety(request, env);
  if (path === "/api/texts" && request.method === "GET") return publicTexts(url, env);
  if (path === "/api/recordings" && request.method === "POST") return createRecording(request, env);

  if (path.startsWith("/api/admin/")) {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
  }

  if (path === "/api/admin/varieties" && request.method === "GET") return adminVarieties(url, env);
  if (path === "/api/admin/varieties" && request.method === "POST") return createAdminVariety(request, env);
  const varietyStatus = path.match(/^\/api\/admin\/varieties\/(\d+)\/status$/);
  if (varietyStatus && request.method === "POST") return setVarietyStatus(Number(varietyStatus[1]), request, env);

  if (path === "/api/admin/texts" && request.method === "GET") return adminTexts(url, env);
  if (path === "/api/admin/texts" && request.method === "POST") return createText(request, env);
  const textDelete = path.match(/^\/api\/admin\/texts\/(\d+)$/);
  if (textDelete && request.method === "DELETE") return deleteText(Number(textDelete[1]), env);

  if (path === "/api/admin/recordings" && request.method === "GET") return adminRecordings(url, env);
  const recordingStatus = path.match(/^\/api\/admin\/recordings\/(\d+)\/status$/);
  if (recordingStatus && request.method === "POST") return setRecordingStatus(Number(recordingStatus[1]), request, env);
  const recordingAudioPath = path.match(/^\/api\/admin\/recordings\/(\d+)\/audio$/);
  if (recordingAudioPath && request.method === "GET") return recordingAudio(Number(recordingAudioPath[1]), env);
  const recordingDelete = path.match(/^\/api\/admin\/recordings\/(\d+)$/);
  if (recordingDelete && request.method === "DELETE") return deleteRecording(Number(recordingDelete[1]), env);
  if (path === "/api/admin/export" && request.method === "GET") return exportManifest(url, env);

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return withCors(await route(request, env), request, env);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Internal server error";
      return withCors(json({ error: message }, 500), request, env);
    }
  }
};
