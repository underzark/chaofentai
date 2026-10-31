# Release candidate v36-rc1

- Product baseline: v36. No production behavior or deployment changed for this candidate.
- Fresh-install correction: migration journal now includes 0006_manual_trial and all ten files in order. Added executable regression.
- Local preview applies all migrations; D1 write metadata / R2 ranges match test expectations; all paid flags false.
- Replaced outdated deployment, daily-use, handoff and history instructions. Added environment placeholders, credential ignores, testing and third-party notices.
- Product regression: 16 groups passed; new journal-driven installation check passed. Build and ESM validation passed.
- Fresh npm installation of pinned Miniflare succeeded; local workerd JPEG, 24MiB response, heavy-work exclusion, 1/2/4MiB chunk SHA and recovery checks passed with zero paid POSTs. This is not a hosted-memory measurement.
- Fresh npm installation of pinned Miniflare succeeded; local workerd JPEG, 24MiB response, heavy-work exclusion, 1/2/4MiB chunk SHA and recovery checks passed with zero paid POSTs. This is not a hosted-memory measurement.
- Fresh npm installation of pinned Miniflare succeeded; local workerd JPEG, 24MiB response, heavy-work exclusion, 1/2/4MiB chunk SHA and recovery checks passed with zero paid POSTs. This is not a hosted-memory measurement.
- Local loopback fresh preview returned HTTP 200, LIVE/POLL/Work false.
- No user media, production data, personal IDs, runtime logs or development Git history included. Synthetic JPEG fixtures and generic brand PNGs are intentionally included.
- Secret scan has one intentional fake sentinel in scripts/test-diagnostics.mjs, used to verify redaction; it is not a working key.
- New private Site from-zero hosting, new-account permissions, actual phone share UI and ChatGPT Windows embedded normal-click save require deployment/user acceptance. Right-click Save link as remains a documented fallback.
- Before public upload: independent candidate review and explicit target repository selection. No remote repository created or pushed by this preparation.
