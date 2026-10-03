# Opal Shelf — Project Context

## Source of truth
- Repository: jedavid33-design/opal-shelf
- GitHub root files are the source of truth.
- Keep deliverables flat: all files at repository root, no nested folders.
- When Julie says “push”, update the GitHub repository directly, including worker.js.
- After a push, state whether Cloudflare Worker deployment or any other Cloudflare action is required.

## Current build
- Version: 0.0.31
- Status before this build: green.
- No ratings.
- Font/UI direction: Avenir Next with the “Opal treatment”.
- Strict rule: no paid catalog/API services.

## v0.0.31 — live Widgy renderer (2026-10-03)
- The Shelf book-detail “Show in widget” checkmark is the sole source of truth for the iOS small Currently Reading widget.
- Selection is singular: checking a new book atomically clears the previous widget selection.
- Added public read-only `GET /widget/currently-reading` for Widgy Web Screenshot. It renders only the selected book’s cover, title, author, progress, and today’s minutes; it does not expose the library or API token.
- Widget styling: Avenir Next, dark plum text, full-bleed opal background, centered CURRENTLY READING header, large cover left, vertically centered title/author/progress/time stack right.
- The widget response sends no-store/no-cache headers to replace the old GitHub Pages `widget-current.png` cache trap.
- Cloudflare Worker deployment is required after this commit. In Widgy, the existing image layer must be switched from Web URL PNG to Web Screenshot using the deployed Worker’s `/widget/currently-reading` URL.

## v0.0.28 — full session-integrity audit fixes (2026-10-01)
All 5 major + 10 minor findings from `~/workspace/site-audits/opal-shelf-AUDIT-2026-10-01.md` addressed. Hard rules honored: no existing session row merged/modified/deleted (the ~230 pre-fix fragmented rows remain Julie's decision); inferred-estimate corrections use negative adjustment rows only.
- M1: `client_session_id` UNIQUE column + `ON CONFLICT DO NOTHING` on POST /api/sessions; exact-duplicate fallback replay for key-less retries. Reader contract in READER-SYNC-CONTRACT.md. Old-client limitation: retries whose payload changed (90s merge-extend) 409 and eventually drop — only a Reader build sending the key fully fixes old builds.
- M2: `localDateTimeIso` appends the device UTC offset; worker normalizes to UTC Z for storage. New writes correct; old shifted rows untouched.
- M3: read_throughs CHECKs widened (state +paused, format +other) via verbatim table rebuild; UI options now work, including the paused-period machinery.
- M4: stale (>24h) open timers refused-with-age on start (never auto-modified); stop caps at 24h, 400s end<start, validates timestamps; start defaults local_date.
- M5/m7: `source` column (timer/manual/reader/inferred/adjustment); late arrivals void overlapped inferred estimates via adjustment rows; downward audiobook corrections void the prior save's estimate.
- m1: read delete cascades read_state_periods. m2: atomic backfill INSERT..WHERE NOT EXISTS; bootstrap merges duplicate same-state periods for active-day math (4 pre-v0.0.27 duplicate pairs still in D1, untouched). m3: active-read requirement, overlap 409s, local_date-vs-start check, exact-dupe replay. m5: shelf rename 409/404s. m6: NaN→null coercion. m8: read edits send local_date. m9: deleted-read 404 names re-link step (Reader-side surfacing still needed). m10: version labels → 0.0.28.
- Data migrations are idempotent and run inside the worker on first request (ensureSchema).

## Data model / behavior
- Books and read-throughs are separate.
- Read-throughs preserve rereads, format, progress, state, sessions, and snapshots.
- Individual reading sessions are editable, movable, addable, and deletable.
- Daily history preserves exact session duration including seconds.
- Paused/DNF periods are excluded from active-day calculations; ordinary no-reading days still count as active.
- Want to Read and Finished Reading use spine views.
- Permanent Delete Book is hidden under Edit Book → Advanced book management and requires confirmation.

## Catalog
- Free sources only.
- Open Library + Google Books.
- ISBN and ASIN are supported identifiers.
- Exact ISBN/edition matches are preferred where available.
- KU/self-published titles may require manual metadata if absent from free catalogs.

## Progress
- Ebook/physical page ↔ percent crossover works in Update Progress.
- First-open previous-day reconciliation also has page ↔ percent crossover.
- Estimated time remaining:
  - ebook/physical: based on measured pages/hour for that read-through.
  - audiobook: remaining content divided by current playback speed.
  - hidden when there is not enough data.

## v0.0.27
1. Fixed: the first-open daily reconciliation ("Yesterday's Reading") now records
   an inferred listening session for audiobooks when the reconciled percent
   advances, mirroring the Update Progress endpoint. The session is dated to the
   reconciled day (midday-anchored; exact clock time unknown) with duration =
   content-delta / listening speed, minus timer sessions already logged that day.
   Re-saving the same check-in advances nothing, so no duplicate session is
   created. The save toast now reports the inferred listening time, e.g.
   "Progress saved to Sep 25 · 13m listening added". Previously a check-in saved
   position only, so Sessions stayed 0 and "reading days" never counted
   audiobook check-ins.
2. Fixed: creating a read-through inserted TWO identical "active" state periods
   (the backfill in ensureReadStatePeriods plus an unconditional INSERT),
   doubling active-day counts (e.g. a book added yesterday showed 4 active days).
   Creation now goes through the idempotent recordReadStateChange; existing
   duplicate periods were removed from D1.

## v0.0.26
1. Fixed: first-open daily reconciliation no longer asks about finished or DNF
   books. `pendingCheckins` in worker.js now only returns read-throughs with
   state `active`/`paused` (previously the `finish_date` allowance let a book
   finished today keep prompting about yesterday on every app refocus, and old
   unreconciled sessions on finished books were retained forever).
2. `completeRead` in app.js now drops the just-finished/DNF read from the
   already-loaded checkin queue so it can't pop up later in the same session.

## v0.0.25
1. Daily reconciliation now asks about every read-through that was active yesterday, not only books with timed sessions.
   - Timed books show known duration/session count.
   - Untimed books can be marked “Didn’t read”.
   - “I read, but didn’t time it” opens Add Session prefilled to yesterday.
   - Older unreconciled timed sessions are still preserved.
2. Added Opal Shelf Import v1.
   - JSON format: {"format":"opal-shelf-import","version":1,"books":[...]}.
   - Shelf → Import Books uploads the file and previews all books before committing.
   - Existing books are detected by ISBN, ASIN, or normalized title+author and skipped.
   - User can deselect books before import.
   - Imported books default to Want to Read.
   - Intended workflow: a ChatGPT book thread can generate one Opal Shelf import JSON for books Julie wants to read.

## Opal Shelf Import v1 fields
Minimum:
- title
- authors (array preferred; author string accepted)

Optional:
- subtitle
- series_name / series
- series_number
- isbn
- asin
- cover_url
- description
- genres
- publisher
- publication_date
- page_count
- audiobook_runtime_seconds
- narrators
- language
- personal_tags
- format_metadata
- favorite
- status (import UI currently forces new imports to Want to Read)
