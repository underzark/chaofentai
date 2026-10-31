ALTER TABLE assets ADD COLUMN mime TEXT NOT NULL DEFAULT 'image/png';
ALTER TABLE assets ADD COLUMN normalized_id TEXT;
