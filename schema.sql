PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS varieties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  language_tag TEXT,
  region TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'archived')),
  created_by TEXT NOT NULL DEFAULT 'seed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS texts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variety_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  reference_text TEXT,
  local_text TEXT,
  source TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'user')),
  prompt_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (variety_id) REFERENCES varieties(id)
);

CREATE TABLE IF NOT EXISTS recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text_id INTEGER NOT NULL,
  variety_id INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_ms INTEGER,
  speaker_id TEXT NOT NULL,
  speaker_label TEXT,
  consent_archive INTEGER NOT NULL DEFAULT 1 CHECK (consent_archive IN (0, 1)),
  consent_training INTEGER NOT NULL DEFAULT 0 CHECK (consent_training IN (0, 1)),
  consent_version TEXT NOT NULL DEFAULT '2026-08-16',
  reference_text_snapshot TEXT,
  transcript_text_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  user_agent TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (text_id) REFERENCES texts(id),
  FOREIGN KEY (variety_id) REFERENCES varieties(id)
);

CREATE INDEX IF NOT EXISTS idx_varieties_status ON varieties(status);
CREATE INDEX IF NOT EXISTS idx_texts_variety_status ON texts(variety_id, status);
CREATE INDEX IF NOT EXISTS idx_recordings_variety_status ON recordings(variety_id, status);
CREATE INDEX IF NOT EXISTS idx_recordings_text_id ON recordings(text_id);
CREATE INDEX IF NOT EXISTS idx_recordings_speaker_id ON recordings(speaker_id);

INSERT OR IGNORE INTO varieties (
  slug, name, language_tag, region, description, status, created_by
) VALUES (
  'yangjiang-cantonese',
  'Yangjiang Cantonese',
  'yue',
  'Yangjiang, Guangdong, China',
  'The first seed variety used by DialectSeed.',
  'active',
  'seed'
);

INSERT OR IGNORE INTO texts (variety_id, content, reference_text, local_text, source, prompt_key)
SELECT id, 'The weather is nice today. I want to take a walk by the river.', 'The weather is nice today. I want to take a walk by the river.', NULL, 'seed', 'yj-001'
FROM varieties WHERE slug = 'yangjiang-cantonese';

INSERT OR IGNORE INTO texts (variety_id, content, reference_text, local_text, source, prompt_key)
SELECT id, 'Please say this sentence slowly and naturally.', 'Please say this sentence slowly and naturally.', NULL, 'seed', 'yj-002'
FROM varieties WHERE slug = 'yangjiang-cantonese';

INSERT OR IGNORE INTO texts (variety_id, content, reference_text, local_text, source, prompt_key)
SELECT id, 'Grandma''s cooking always tastes special.', 'Grandma''s cooking always tastes special.', NULL, 'seed', 'yj-003'
FROM varieties WHERE slug = 'yangjiang-cantonese';

INSERT OR IGNORE INTO texts (variety_id, content, reference_text, local_text, source, prompt_key)
SELECT id, 'When I heard this as a child, I knew it was time to go home.', 'When I heard this as a child, I knew it was time to go home.', NULL, 'seed', 'yj-004'
FROM varieties WHERE slug = 'yangjiang-cantonese';

INSERT OR IGNORE INTO texts (variety_id, content, reference_text, local_text, source, prompt_key)
SELECT id, 'This old street holds many childhood memories.', 'This old street holds many childhood memories.', NULL, 'seed', 'yj-005'
FROM varieties WHERE slug = 'yangjiang-cantonese';

INSERT OR IGNORE INTO texts (variety_id, content, reference_text, local_text, source, prompt_key)
SELECT id, 'We want to preserve the voices of our hometown.', 'We want to preserve the voices of our hometown.', NULL, 'seed', 'yj-006'
FROM varieties WHERE slug = 'yangjiang-cantonese';
