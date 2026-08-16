PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS varieties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  language_tag TEXT,
  region TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT NOT NULL DEFAULT 'seed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO varieties (
  slug, name, language_tag, region, description, status, created_by
) VALUES (
  'yangjiang-cantonese',
  'Yangjiang Cantonese',
  'yue',
  'Yangjiang, Guangdong, China',
  'Migrated from the original single-variety DialectSeed prototype.',
  'active',
  'migration'
);

ALTER TABLE texts ADD COLUMN variety_id INTEGER;
ALTER TABLE texts ADD COLUMN reference_text TEXT;
ALTER TABLE texts ADD COLUMN local_text TEXT;

UPDATE texts
SET variety_id = (SELECT id FROM varieties WHERE slug = 'yangjiang-cantonese')
WHERE variety_id IS NULL;

UPDATE texts
SET reference_text = COALESCE(mandarin_text, content)
WHERE reference_text IS NULL;

UPDATE texts
SET local_text = yangjiang_text
WHERE local_text IS NULL AND yangjiang_text IS NOT NULL AND trim(yangjiang_text) <> '';

ALTER TABLE recordings ADD COLUMN variety_id INTEGER;
ALTER TABLE recordings ADD COLUMN speaker_id TEXT;
ALTER TABLE recordings ADD COLUMN consent_archive INTEGER NOT NULL DEFAULT 1;
ALTER TABLE recordings ADD COLUMN consent_training INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recordings ADD COLUMN consent_version TEXT NOT NULL DEFAULT '2026-08-16';
ALTER TABLE recordings ADD COLUMN reference_text_snapshot TEXT;
ALTER TABLE recordings ADD COLUMN transcript_text_snapshot TEXT;

UPDATE recordings
SET variety_id = (
  SELECT t.variety_id FROM texts t WHERE t.id = recordings.text_id
)
WHERE variety_id IS NULL;

UPDATE recordings
SET speaker_id = 'legacy-' || id
WHERE speaker_id IS NULL OR trim(speaker_id) = '';

UPDATE recordings
SET reference_text_snapshot = (
  SELECT COALESCE(t.reference_text, t.content) FROM texts t WHERE t.id = recordings.text_id
)
WHERE reference_text_snapshot IS NULL;

UPDATE recordings
SET transcript_text_snapshot = (
  SELECT t.local_text FROM texts t WHERE t.id = recordings.text_id
)
WHERE transcript_text_snapshot IS NULL;

-- Historical recordings did not include explicit model-training consent.
UPDATE recordings SET consent_training = 0;

CREATE INDEX IF NOT EXISTS idx_varieties_status ON varieties(status);
CREATE INDEX IF NOT EXISTS idx_texts_variety_status ON texts(variety_id, status);
CREATE INDEX IF NOT EXISTS idx_recordings_variety_status ON recordings(variety_id, status);
CREATE INDEX IF NOT EXISTS idx_recordings_speaker_id ON recordings(speaker_id);

PRAGMA foreign_keys = ON;
