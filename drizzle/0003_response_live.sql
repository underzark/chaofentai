ALTER TABLE response_jobs ADD COLUMN original_asset TEXT;
ALTER TABLE response_jobs ADD COLUMN result_asset TEXT;
ALTER TABLE response_jobs ADD COLUMN error_code TEXT;
ALTER TABLE response_jobs ADD COLUMN created_at INTEGER;
ALTER TABLE response_jobs ADD COLUMN updated_at INTEGER;
ALTER TABLE response_jobs ADD COLUMN input_asset TEXT;
ALTER TABLE response_jobs ADD COLUMN original_prompt TEXT;
