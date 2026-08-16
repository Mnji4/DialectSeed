import {
  HelpCircle,
  Mic,
  RefreshCw,
  Send,
  Square,
  UploadCloud
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminPage } from "./AdminPage";

type Variety = {
  id: number;
  slug: string;
  name: string;
  language_tag?: string | null;
  region?: string | null;
  description?: string | null;
  status: "pending" | "active" | "archived";
};

type TextItem = {
  id: number;
  variety_id: number;
  content: string;
  reference_text?: string | null;
  local_text?: string | null;
  source?: "seed" | "user";
};

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ??
  (globalThis.location.hostname === "localhost" ? "http://localhost:8787" : "");
const SPEAKER_ID_KEY = "dialectseed_speaker_id";
const TEXT_LOAD_TIMEOUT_MS = 8000;

function makeId() {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    const bytes = new Uint8Array(16);
    globalThis.crypto?.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}

function getSpeakerId() {
  try {
    const saved = localStorage.getItem(SPEAKER_ID_KEY);
    if (saved) return saved;
    const id = makeId();
    localStorage.setItem(SPEAKER_ID_KEY, id);
    return id;
  } catch {
    return makeId();
  }
}

function preferredAudioType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function audioFileExtension(type: string) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("aac")) return "aac";
  if (type.includes("wav")) return "wav";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

export function App() {
  if (window.location.pathname.startsWith("/admin")) {
    return <AdminPage />;
  }

  const [varieties, setVarieties] = useState<Variety[]>([]);
  const [varietyId, setVarietyId] = useState<number | null>(null);
  const [texts, setTexts] = useState<TextItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [speakerId, setSpeakerId] = useState("");
  const [speakerLabel, setSpeakerLabel] = useState("");
  const [transcript, setTranscript] = useState("");
  const [trainingConsent, setTrainingConsent] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobType, setBlobType] = useState("audio/webm");
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("Loading available speech varieties...");
  const [showRequest, setShowRequest] = useState(false);
  const [requestName, setRequestName] = useState("");
  const [requestRegion, setRequestRegion] = useState("");
  const [requestLanguageTag, setRequestLanguageTag] = useState("");
  const [requestDescription, setRequestDescription] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    setSpeakerId(getSpeakerId());
    void loadVarieties();
  }, []);

  useEffect(() => {
    if (varietyId) void loadTexts(varietyId);
  }, [varietyId]);

  async function loadVarieties() {
    try {
      const response = await fetch(`${API_BASE}/api/varieties`, { cache: "no-store" });
      const data = (await response.json()) as { varieties?: Variety[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Failed to load varieties");
      const items = data.varieties ?? [];
      setVarieties(items);
      if (items[0]) setVarietyId((current) => current ?? items[0].id);
      setStatus(items.length ? "Choose a prompt and record a natural reading." : "No active varieties yet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load varieties");
    }
  }

  async function loadTexts(nextVarietyId = varietyId) {
    if (!nextVarietyId) return;
    setIsLoading(true);
    setStatus("Loading prompts...");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), TEXT_LOAD_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${API_BASE}/api/texts?varietyId=${nextVarietyId}&limit=5`,
        { cache: "no-store", signal: controller.signal }
      );
      const data = (await response.json()) as { texts?: TextItem[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Failed to load prompts");
      const items = data.texts ?? [];
      setTexts(items);
      applyText(items[0] ?? null);
      setStatus(items.length ? "Choose a prompt and record a natural reading." : "No prompts are available for this variety yet.");
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "Prompt loading timed out. Try again."
          : error instanceof Error
            ? error.message
            : "Failed to load prompts";
      setTexts([]);
      applyText(null);
      setStatus(message);
    } finally {
      window.clearTimeout(timeout);
      setIsLoading(false);
    }
  }

  function applyText(item: TextItem | null) {
    setSelectedId(item?.id ?? null);
    setTranscript(item?.local_text ?? "");
    setBlob(null);
    setDurationMs(null);
  }

  const selectedText = useMemo(
    () => texts.find((item) => item.id === selectedId) ?? null,
    [selectedId, texts]
  );

  const selectedVariety = useMemo(
    () => varieties.find((item) => item.id === varietyId) ?? null,
    [varieties, varietyId]
  );

  const audioUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  async function startRecording() {
    if (!selectedText || !selectedVariety) {
      setStatus("Choose a prompt first.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatus("This browser does not support in-browser recording. Try a current version of Chrome or Safari.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredAudioType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const type = recorder.mimeType || mimeType || "audio/webm";
        const startedAt = startedAtRef.current;
        setBlob(new Blob(chunksRef.current, { type }));
        setBlobType(type);
        setDurationMs(startedAt ? Date.now() - startedAt : null);
        startedAtRef.current = null;
        setStatus("Recording complete. Review the transcript and upload when ready.");
      };

      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setBlob(null);
      setDurationMs(null);
      setIsRecording(true);
      setStatus("Recording...");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Microphone access failed");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setIsRecording(false);
  }

  async function uploadRecording() {
    if (!blob || !selectedText || !selectedVariety) return;
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) {
      setStatus("Add the words you actually said before uploading.");
      return;
    }

    setStatus("Uploading...");
    const form = new FormData();
    form.set("textId", String(selectedText.id));
    form.set("varietyId", String(selectedVariety.id));
    form.set("durationMs", String(durationMs ?? 0));
    form.set("speakerId", speakerId);
    form.set("speakerLabel", speakerLabel.trim());
    form.set("transcriptText", cleanTranscript);
    form.set("consentArchive", "1");
    form.set("consentTraining", trainingConsent ? "1" : "0");
    form.set("consentVersion", "2026-08-16");
    form.set("audio", blob, `recording-${selectedText.id}.${audioFileExtension(blobType)}`);

    const response = await fetch(`${API_BASE}/api/recordings`, { method: "POST", body: form });
    const data = (await response.json()) as { error?: string; status?: string };
    if (!response.ok) {
      setStatus(data.error ?? "Upload failed");
      return;
    }

    setBlob(null);
    setDurationMs(null);
    setStatus(`Uploaded. Moderation status: ${data.status ?? "pending"}.`);
  }

  async function submitVarietyRequest() {
    const name = requestName.trim();
    if (name.length < 2) {
      setStatus("Enter a variety name.");
      return;
    }

    const response = await fetch(`${API_BASE}/api/varieties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        region: requestRegion.trim() || undefined,
        languageTag: requestLanguageTag.trim() || undefined,
        description: requestDescription.trim() || undefined
      })
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setStatus(data.error ?? "Variety request failed");
      return;
    }

    setRequestName("");
    setRequestRegion("");
    setRequestLanguageTag("");
    setRequestDescription("");
    setShowRequest(false);
    setStatus("Variety request submitted for review.");
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className="panel side-panel">
          <div>
            <p className="kicker">DialectSeed</p>
            <h1>Grow a speech corpus for your hometown voice.</h1>
            <p className="intro">
              Collect natural recordings with transcripts, speaker separation, explicit consent, and a path to ASR or TTS datasets.
            </p>
          </div>

          <label className="field">
            <span>Speech variety</span>
            <select
              value={varietyId ?? ""}
              onChange={(event) => setVarietyId(Number(event.target.value))}
              disabled={!varieties.length}
            >
              {varieties.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}{item.region ? ` - ${item.region}` : ""}
                </option>
              ))}
            </select>
            <small>{selectedVariety?.description ?? "Choose the local speech variety you want to contribute to."}</small>
          </label>

          <button className="link-button" type="button" onClick={() => setShowRequest((value) => !value)}>
            {showRequest ? "Hide variety request" : "My variety is missing"}
          </button>

          {showRequest ? (
            <div className="variety-request">
              <input placeholder="Variety name" value={requestName} onChange={(e) => setRequestName(e.target.value)} />
              <input placeholder="Region (optional)" value={requestRegion} onChange={(e) => setRequestRegion(e.target.value)} />
              <input placeholder="Language tag, e.g. yue (optional)" value={requestLanguageTag} onChange={(e) => setRequestLanguageTag(e.target.value)} />
              <textarea placeholder="Short description (optional)" value={requestDescription} onChange={(e) => setRequestDescription(e.target.value)} rows={3} />
              <button type="button" onClick={submitVarietyRequest}><Send size={16} /> Submit request</button>
            </div>
          ) : null}

          <label className="field">
            <span>Speaker label (optional)</span>
            <input value={speakerLabel} onChange={(event) => setSpeakerLabel(event.target.value)} placeholder="e.g. contributor-01" />
            <small>The browser also stores a random anonymous speaker ID so dataset splits can keep one speaker in one split.</small>
          </label>

          <details className="help-box">
            <summary><HelpCircle size={16} /> Recording guidance</summary>
            <p>Speak naturally, keep the microphone at a stable distance, and avoid music or other voices in the background.</p>
            <p>The reference prompt is a meaning cue. The transcript should contain what you actually said in the target variety.</p>
          </details>
        </aside>

        <section className="panel recorder-panel">
          <div className="list-heading">
            <div>
              <p className="kicker">Prompt set</p>
              <h2>{selectedVariety?.name ?? "No active variety"}</h2>
            </div>
            <button className="retry-button" type="button" onClick={() => void loadTexts()} disabled={isLoading || !varietyId}>
              <RefreshCw size={16} /> {isLoading ? "Loading..." : "Refresh prompts"}
            </button>
          </div>

          <div className="candidate-list">
            {texts.map((item) => (
              <button
                className={`text-row ${item.id === selectedId ? "selected" : ""}`}
                key={item.id}
                type="button"
                onClick={() => applyText(item)}
              >
                <span>{item.reference_text || item.content}</span>
                {item.local_text ? <small>Suggested local form: {item.local_text}</small> : null}
              </button>
            ))}
          </div>

          {selectedText ? (
            <>
              <div className="prompt">
                <span>Reference meaning</span>
                <p>{selectedText.reference_text || selectedText.content}</p>
              </div>

              <label className="editable-text">
                <span className="edit-heading"><span>What you actually said</span></span>
                <textarea
                  rows={4}
                  value={transcript}
                  onChange={(event) => setTranscript(event.target.value)}
                  placeholder="Write the spoken form in the target variety. This becomes the supervised transcript."
                />
              </label>

              <div className={`meter ${isRecording ? "active" : ""}`} aria-hidden="true">
                {Array.from({ length: 8 }).map((_, index) => <i key={index} />)}
              </div>

              <div className="actions">
                {!isRecording ? (
                  <button className="primary" onClick={startRecording} type="button"><Mic size={18} /> Start recording</button>
                ) : (
                  <button className="primary" onClick={stopRecording} type="button"><Square size={18} /> Stop recording</button>
                )}
                <button onClick={() => void loadTexts()} type="button" disabled={isRecording}><RefreshCw size={18} /> New prompts</button>
              </div>

              {audioUrl ? <audio controls src={audioUrl} /> : null}

              <div className="consent-box">
                <label>
                  <input type="checkbox" checked readOnly />
                  <span>I allow this recording and its transcript to be stored for language preservation and research.</span>
                </label>
                <label>
                  <input type="checkbox" checked={trainingConsent} onChange={(event) => setTrainingConsent(event.target.checked)} />
                  <span>I also allow this recording and transcript to be used to train and evaluate speech models, including ASR and TTS.</span>
                </label>
              </div>

              <div className="actions">
                <button className="primary" disabled={!blob || isRecording} onClick={uploadRecording} type="button">
                  <UploadCloud size={18} /> Upload contribution
                </button>
              </div>
            </>
          ) : null}

          <p className="status">{status}</p>
        </section>
      </section>
    </main>
  );
}
