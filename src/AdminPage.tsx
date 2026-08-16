import { Archive, Check, Download, LogOut, Play, Plus, RefreshCw, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ??
  (globalThis.location.hostname === "localhost" ? "http://localhost:8787" : "");
const ADMIN_TOKEN_KEY = "dialectseed_admin_token";

type VarietyStatus = "pending" | "active" | "archived";
type RecordingStatus = "pending" | "approved" | "rejected";
type Tab = "recordings" | "texts" | "varieties";

type Variety = {
  id: number;
  slug: string;
  name: string;
  language_tag: string | null;
  region: string | null;
  description: string | null;
  status: VarietyStatus;
  created_by: string;
  created_at: string;
  text_count?: number;
  recording_count?: number;
};

type AdminText = {
  id: number;
  variety_id: number;
  variety_name: string;
  content: string;
  reference_text: string | null;
  local_text: string | null;
  source: "seed" | "user";
  status: "active" | "archived";
  created_at: string;
  recording_count: number;
};

type AdminRecording = {
  id: number;
  text_id: number;
  variety_id: number;
  variety_name: string;
  r2_key: string;
  mime_type: string;
  size_bytes: number;
  duration_ms: number | null;
  speaker_id: string;
  speaker_label: string | null;
  consent_training: number;
  consent_version: string;
  reference_text_snapshot: string | null;
  transcript_text_snapshot: string | null;
  status: RecordingStatus;
  created_at: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) ?? "");
  const [tokenInput, setTokenInput] = useState("");
  const [tab, setTab] = useState<Tab>("recordings");
  const [status, setStatus] = useState("");
  const [varieties, setVarieties] = useState<Variety[]>([]);
  const [texts, setTexts] = useState<AdminText[]>([]);
  const [recordings, setRecordings] = useState<AdminRecording[]>([]);
  const [audioUrl, setAudioUrl] = useState("");
  const [playingId, setPlayingId] = useState<number | null>(null);

  const [recordingStatus, setRecordingStatus] = useState("");
  const [recordingVariety, setRecordingVariety] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [query, setQuery] = useState("");
  const [trainingOnly, setTrainingOnly] = useState(false);

  const [textVariety, setTextVariety] = useState("");
  const [textSource, setTextSource] = useState("");
  const [textQuery, setTextQuery] = useState("");
  const [newTextVariety, setNewTextVariety] = useState("");
  const [newReferenceText, setNewReferenceText] = useState("");
  const [newLocalText, setNewLocalText] = useState("");

  const [newVarietyName, setNewVarietyName] = useState("");
  const [newVarietyRegion, setNewVarietyRegion] = useState("");
  const [newVarietyTag, setNewVarietyTag] = useState("");
  const [newVarietyDescription, setNewVarietyDescription] = useState("");

  function headers(extra: HeadersInit = {}) {
    return { Authorization: `Bearer ${token}`, ...extra };
  }

  async function apiJson<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: headers(init.headers ?? {})
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
    return data;
  }

  const activeVarieties = useMemo(() => varieties.filter((item) => item.status === "active"), [varieties]);

  useEffect(() => {
    if (!token) return;
    void loadVarieties();
    void loadRecordings();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (tab === "recordings") void loadRecordings();
    if (tab === "texts") void loadTexts();
    if (tab === "varieties") void loadVarieties();
  }, [tab]);

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  async function loadVarieties() {
    try {
      const data = await apiJson<{ varieties: Variety[] }>("/api/admin/varieties");
      setVarieties(data.varieties ?? []);
      const first = data.varieties?.find((item) => item.status === "active");
      if (first) setNewTextVariety((current) => current || String(first.id));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load varieties");
    }
  }

  async function loadRecordings() {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (recordingStatus) params.set("status", recordingStatus);
      if (recordingVariety) params.set("varietyId", recordingVariety);
      if (speaker.trim()) params.set("speaker", speaker.trim());
      if (query.trim()) params.set("q", query.trim());
      if (trainingOnly) params.set("trainingOnly", "1");
      const data = await apiJson<{ recordings: AdminRecording[]; total: number }>(`/api/admin/recordings?${params}`);
      setRecordings(data.recordings ?? []);
      setStatus(`${data.total ?? 0} recording(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load recordings");
    }
  }

  async function loadTexts() {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (textVariety) params.set("varietyId", textVariety);
      if (textSource) params.set("source", textSource);
      if (textQuery.trim()) params.set("q", textQuery.trim());
      const data = await apiJson<{ texts: AdminText[]; total: number }>(`/api/admin/texts?${params}`);
      setTexts(data.texts ?? []);
      setStatus(`${data.total ?? 0} prompt(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load prompts");
    }
  }

  function saveToken() {
    const clean = tokenInput.trim();
    if (!clean) return;
    localStorage.setItem(ADMIN_TOKEN_KEY, clean);
    setToken(clean);
    setTokenInput("");
  }

  function logout() {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setToken("");
    setRecordings([]);
    setTexts([]);
    setVarieties([]);
    setStatus("");
  }

  async function setRecordingState(id: number, next: RecordingStatus) {
    try {
      await apiJson(`/api/admin/recordings/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next })
      });
      setRecordings((items) => items.map((item) => item.id === id ? { ...item, status: next } : item));
      setStatus(`Recording #${id} is now ${next}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Status update failed");
    }
  }

  async function removeRecording(item: AdminRecording) {
    if (!window.confirm(`Delete recording #${item.id} and its audio object?`)) return;
    try {
      await apiJson(`/api/admin/recordings/${item.id}`, { method: "DELETE" });
      setRecordings((items) => items.filter((recording) => recording.id !== item.id));
      setStatus(`Recording #${item.id} deleted.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed");
    }
  }

  async function playRecording(item: AdminRecording) {
    try {
      const response = await fetch(`${API_BASE}/api/admin/recordings/${item.id}/audio`, { headers: headers() });
      if (!response.ok) throw new Error("Audio download failed");
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const next = URL.createObjectURL(await response.blob());
      setAudioUrl(next);
      setPlayingId(item.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Playback failed");
    }
  }

  async function createText() {
    if (!newTextVariety || newReferenceText.trim().length < 2) {
      setStatus("Choose a variety and provide a reference prompt.");
      return;
    }
    try {
      await apiJson("/api/admin/texts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          varietyId: Number(newTextVariety),
          referenceText: newReferenceText.trim(),
          localText: newLocalText.trim() || undefined,
          source: "seed"
        })
      });
      setNewReferenceText("");
      setNewLocalText("");
      await loadTexts();
      setStatus("Prompt created.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Prompt creation failed");
    }
  }

  async function removeText(item: AdminText) {
    if (!window.confirm(`Delete prompt #${item.id}?`)) return;
    try {
      await apiJson(`/api/admin/texts/${item.id}`, { method: "DELETE" });
      setTexts((items) => items.filter((text) => text.id !== item.id));
      setStatus(`Prompt #${item.id} deleted.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Prompt deletion failed");
    }
  }

  async function createVariety() {
    if (newVarietyName.trim().length < 2) {
      setStatus("Enter a variety name.");
      return;
    }
    try {
      await apiJson("/api/admin/varieties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newVarietyName.trim(),
          region: newVarietyRegion.trim() || undefined,
          languageTag: newVarietyTag.trim() || undefined,
          description: newVarietyDescription.trim() || undefined
        })
      });
      setNewVarietyName("");
      setNewVarietyRegion("");
      setNewVarietyTag("");
      setNewVarietyDescription("");
      await loadVarieties();
      setStatus("Variety created.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Variety creation failed");
    }
  }

  async function setVarietyState(id: number, next: VarietyStatus) {
    try {
      await apiJson(`/api/admin/varieties/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next })
      });
      setVarieties((items) => items.map((item) => item.id === id ? { ...item, status: next } : item));
      setStatus(`Variety #${id} is now ${next}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Variety update failed");
    }
  }

  async function downloadManifest(task: "asr" | "tts") {
    try {
      const params = new URLSearchParams({ task });
      if (recordingVariety) params.set("varietyId", recordingVariety);
      const response = await fetch(`${API_BASE}/api/admin/export?${params}`, { headers: headers() });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `dialectseed-${task}-manifest.json`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed");
    }
  }

  if (!token) {
    return (
      <main className="admin-shell">
        <section className="admin-login panel">
          <p className="kicker">DialectSeed Admin</p>
          <h1>Corpus moderation</h1>
          <label className="field">
            <span>Admin token</span>
            <input
              autoFocus
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && saveToken()}
              placeholder="ADMIN_TOKEN"
            />
          </label>
          <button className="admin-primary" onClick={saveToken} type="button">Open admin</button>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <section className="admin-header">
        <div><p className="kicker">DialectSeed Admin</p><h1>Corpus moderation</h1></div>
        <button onClick={logout} type="button"><LogOut size={17} /> Log out</button>
      </section>

      <section className="admin-tabs">
        <button className={tab === "recordings" ? "active" : ""} onClick={() => setTab("recordings")} type="button">Recordings</button>
        <button className={tab === "texts" ? "active" : ""} onClick={() => setTab("texts")} type="button">Prompts</button>
        <button className={tab === "varieties" ? "active" : ""} onClick={() => setTab("varieties")} type="button">Varieties</button>
      </section>

      {tab === "recordings" && <>
        <section className="admin-filters panel">
          <label><span>Status</span><select value={recordingStatus} onChange={(e) => setRecordingStatus(e.target.value)}><option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
          <label><span>Variety</span><select value={recordingVariety} onChange={(e) => setRecordingVariety(e.target.value)}><option value="">All</option>{varieties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Speaker</span><input value={speaker} onChange={(e) => setSpeaker(e.target.value)} /></label>
          <label><span>Search</span><input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <label><span>Training eligible</span><select value={trainingOnly ? "1" : "0"} onChange={(e) => setTrainingOnly(e.target.value === "1")}><option value="0">Any</option><option value="1">Eligible only</option></select></label>
          <button onClick={loadRecordings} type="button"><Search size={17} /> Apply</button>
          <button onClick={loadRecordings} type="button"><RefreshCw size={17} /> Refresh</button>
        </section>

        <section className="export-actions panel">
          <span>Training export includes only approved recordings with explicit training consent and a non-empty transcript.</span>
          <div>
            <button onClick={() => downloadManifest("asr")} type="button"><Download size={16} /> ASR manifest</button>
            <button onClick={() => downloadManifest("tts")} type="button"><Download size={16} /> TTS manifest</button>
          </div>
        </section>

        {audioUrl && <section className="admin-player panel"><span>#{playingId}</span><audio controls src={audioUrl} autoPlay /></section>}

        <section className="admin-list">
          {recordings.map((item) => <article className="admin-record panel" key={item.id}>
            <div className="record-main">
              <div className="record-meta"><strong>#{item.id}</strong><span className={`badge ${item.status}`}>{item.status}</span><span>{item.variety_name}</span><span>{item.created_at}</span></div>
              <p>{item.transcript_text_snapshot || "No transcript"}</p>
              <small>Reference: {item.reference_text_snapshot || "-"}</small>
              <small>{item.speaker_label || item.speaker_id} | {formatBytes(item.size_bytes)} | {item.mime_type} | training consent: {item.consent_training ? "yes" : "no"}</small>
              <small className="r2-key">{item.r2_key}</small>
            </div>
            <div className="record-actions">
              <button onClick={() => playRecording(item)} type="button"><Play size={16} /> Play</button>
              <button onClick={() => setRecordingState(item.id, "approved")} type="button"><Check size={16} /> Approve</button>
              <button onClick={() => setRecordingState(item.id, "rejected")} type="button"><X size={16} /> Reject</button>
              <button onClick={() => setRecordingState(item.id, "pending")} type="button"><RotateCcw size={16} /> Pending</button>
              <button className="danger" onClick={() => removeRecording(item)} type="button"><Trash2 size={16} /> Delete</button>
            </div>
          </article>)}
        </section>
      </>}

      {tab === "texts" && <>
        <section className="text-create panel">
          <label><span>Variety</span><select value={newTextVariety} onChange={(e) => setNewTextVariety(e.target.value)}>{activeVarieties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Reference prompt</span><textarea rows={3} value={newReferenceText} onChange={(e) => setNewReferenceText(e.target.value)} /></label>
          <label><span>Suggested local form</span><textarea rows={3} value={newLocalText} onChange={(e) => setNewLocalText(e.target.value)} /></label>
          <button onClick={createText} type="button"><Plus size={16} /> Add prompt</button>
        </section>

        <section className="admin-filters panel">
          <label><span>Variety</span><select value={textVariety} onChange={(e) => setTextVariety(e.target.value)}><option value="">All</option>{varieties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Source</span><select value={textSource} onChange={(e) => setTextSource(e.target.value)}><option value="">All</option><option value="seed">Seed</option><option value="user">User</option></select></label>
          <label><span>Search</span><input value={textQuery} onChange={(e) => setTextQuery(e.target.value)} /></label>
          <button onClick={loadTexts} type="button"><Search size={17} /> Apply</button>
          <button onClick={loadTexts} type="button"><RefreshCw size={17} /> Refresh</button>
        </section>

        <section className="admin-list">
          {texts.map((item) => <article className="admin-record panel" key={item.id}>
            <div className="record-main">
              <div className="record-meta"><strong>#{item.id}</strong><span>{item.variety_name}</span><span>{item.source}</span><span>{item.recording_count} recording(s)</span></div>
              <div className="text-pair"><p><b>Reference</b><span>{item.reference_text || item.content}</span></p><p><b>Suggested local form</b><span>{item.local_text || "-"}</span></p></div>
            </div>
            <div className="record-actions"><button className="danger" onClick={() => removeText(item)} type="button"><Trash2 size={16} /> Delete</button></div>
          </article>)}
        </section>
      </>}

      {tab === "varieties" && <>
        <section className="text-create panel">
          <label><span>Name</span><input value={newVarietyName} onChange={(e) => setNewVarietyName(e.target.value)} /></label>
          <label><span>Region</span><input value={newVarietyRegion} onChange={(e) => setNewVarietyRegion(e.target.value)} /></label>
          <label><span>Language tag</span><input value={newVarietyTag} onChange={(e) => setNewVarietyTag(e.target.value)} placeholder="e.g. yue" /></label>
          <label><span>Description</span><textarea rows={3} value={newVarietyDescription} onChange={(e) => setNewVarietyDescription(e.target.value)} /></label>
          <button onClick={createVariety} type="button"><Plus size={16} /> Add variety</button>
        </section>

        <section className="admin-list">
          {varieties.map((item) => <article className="admin-record panel" key={item.id}>
            <div className="record-main">
              <div className="record-meta"><strong>#{item.id}</strong><span className={`badge ${item.status === "active" ? "approved" : item.status === "pending" ? "pending" : "rejected"}`}>{item.status}</span><span>{item.language_tag || "no tag"}</span><span>{item.created_by}</span></div>
              <p>{item.name}</p>
              <small>{item.region || "No region specified"}</small>
              <small>{item.description || "No description"}</small>
              <small>{item.text_count ?? 0} prompt(s) | {item.recording_count ?? 0} recording(s)</small>
            </div>
            <div className="record-actions">
              <button onClick={() => setVarietyState(item.id, "active")} type="button"><Check size={16} /> Activate</button>
              <button onClick={() => setVarietyState(item.id, "pending")} type="button"><RotateCcw size={16} /> Pending</button>
              <button onClick={() => setVarietyState(item.id, "archived")} type="button"><Archive size={16} /> Archive</button>
            </div>
          </article>)}
        </section>
      </>}

      <p className="status admin-status">{status}</p>
    </main>
  );
}
