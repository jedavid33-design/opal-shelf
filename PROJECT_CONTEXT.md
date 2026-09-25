# Opal Shelf — Project Context

## Source of truth
- Repository: jedavid33-design/opal-shelf
- GitHub root files are the source of truth.
- Keep deliverables flat: all files at repository root, no nested folders.
- When Julie says “push”, update the GitHub repository directly, including worker.js.
- After a push, state whether Cloudflare Worker deployment or any other Cloudflare action is required.

## Current build
- Version: 0.0.26
- Status before this build: green.
- No ratings.
- Font/UI direction: Avenir Next with the “Opal treatment”.
- Strict rule: no paid catalog/API services.

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
