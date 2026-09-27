#!/bin/sh
# Start command for a single-container host (Render): the compose stack runs migrate and seed as separate one-shot
# services (deploy/compose.yml), a hosted web service has only this one process, so it runs them first. Both are
# idempotent (additive SQL migrations; ON CONFLICT seeds) and exit non-zero on failure, which stops the start.
set -e
node scripts/migrate.js
node scripts/seed-catalog.js
exec node server.js
