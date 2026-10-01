# Opal Shelf ↔ Opal Reader sync contract (v0.0.28)

How the Reader posts listening sessions to Shelf without double-counting,
and what old Reader builds can't do. Shelf-side is implemented in `worker.js`;
Reader-side changes belong in the opal-reader repo.

## Idempotent session ingest (M1)

`POST /api/sessions` accepts an optional `client_session_id` (string).

- The Reader MUST generate one stable id per outbox item and send it with
  every attempt, including retries. Suggested form:
  `shelf_<shelfReadId>_<startedAtMs>_<perItemCounter>` — unique per queued
  item, stable across retries of that item.
- The worker stores it in the UNIQUE `reading_sessions.client_session_id`
  column and inserts with `INSERT … ON CONFLICT DO NOTHING`.
- First insert → `201` with the session row.
- Retry after a lost response → the existing row is returned with
  `idempotent_replay: true` (status `200`). The Reader treats this exactly
  like success and drops the outbox item.
- Retries that arrive concurrently are safe: exactly one row wins, all
  callers get that row.

### Old-client limitation (pre-idempotency Reader builds)

Old builds cannot send `client_session_id`, and the worker can only dedupe
what it can identify — there is no reliable server-side signature for them:

- The 90s resume-merge can extend an already-posted item, so a retry may
  carry a *longer* duration than the first POST: `(read_id, started_at)`
  alone is not a stable key.
- Best effort the worker does provide for key-less retries:
  - an *exact* `(read_id, started_at, duration_seconds)` re-POST replays the
    existing row (`idempotent_replay: true, replay_match: "exact"`);
  - a re-POST with a genuinely overlapping but different interval gets
    `409` (it no longer silently double-inserts).
- Consequence for old builds: a retry whose payload changed (merge-extend)
  will `409`, the outbox will retry up to 30×, then **drop the minutes**.
  Previously the same scenario double-counted them. Neither is correct —
  the real fix is a Reader build that sends `client_session_id`.

## Deleted read-throughs (m9)

If the Shelf read-through a Reader book is linked to is deleted, every flush
POST returns `404` with the message *"Read-through not found. If this came
from the Opal Reader sync, re-link the book in Opal Shelf and try again."*

Reader-side recommendation: after repeated 404s for a linked `shelfReadId`,
surface **"Re-link this book in Opal Shelf"** to Julie instead of retrying
30× and silently dropping the minutes. Shelf cannot push this signal; the
Reader must watch for it.

## Timestamps

- Send ISO-8601. A UTC-offset designator is preferred for device-local
  times (e.g. `2026-10-01T14:30:00-04:00`); the worker normalizes to UTC
  for storage. All stored timestamps are UTC `…Z`, so SQL ordering and
  interval comparisons stay chronological.
- `local_date` (`YYYY-MM-DD`) should be the device-local date of
  `started_at`. More than 1 day of drift → `400`; exactly 1 day →
  accepted with a `local_date_warning` in the response.

## Timer endpoints

- `POST /api/sessions/start` validates `started_at` (`400` on garbage) and
  defaults a missing `local_date` from the start time instead of `500`ing.
- A timer open for more than 24h is presumed crashed: `start` refuses with
  `409` naming the stale timer's age. Stopping it caps the recorded
  duration at 24h and flags `duration_capped: true` in the stop response.
- `POST /api/sessions/:id/stop` with `ended_at` before `started_at` is a
  `400` (previously recorded a silent `0`).

## Inferred estimates and corrections (M5/m7)

- Sessions Shelf infers (progress / finish / check-in) carry
  `source: "inferred"`. When a real session arrives late overlapping one,
  Shelf inserts a negative `source: "adjustment"` row for the overlapping
  portion — totals stay correct and no existing row is ever modified.
  The response reports `overlap_adjusted_seconds`.
- A downward audiobook progress correction voids the inferred estimate(s)
  from the immediately preceding save the same way
  (`voided_inferred_seconds` in the response).

## Versioning

Shelf reports its version on `GET /health`. The contract above is v0.0.28.
