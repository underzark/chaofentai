ALTER TABLE response_jobs ADD COLUMN manual_grant_id TEXT;
ALTER TABLE response_jobs ADD COLUMN poll_token TEXT;
ALTER TABLE response_jobs ADD COLUMN poll_expires_at INTEGER;
CREATE UNIQUE INDEX response_manual_grant ON response_jobs(manual_grant_id) WHERE manual_grant_id IS NOT NULL;
CREATE TABLE manual_approvals(token TEXT PRIMARY KEY,grant_id TEXT NOT NULL,owner TEXT NOT NULL,fingerprint TEXT NOT NULL,args_json TEXT NOT NULL,price_version TEXT NOT NULL,expires_at INTEGER NOT NULL,ack_json TEXT NOT NULL);
