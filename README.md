# Opal Shelf v0.0.12

Single flat source-of-truth package.

Install:
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.12`.
3. Replace the GitHub repository root files with this ZIP.

No manual D1 migration is required. The Worker creates the additive `read_state_periods` table automatically.

v0.0.12:
- Read-through box score in Reading History and Edit Read-through.
- Physical/ebook: timed reading, pages read, whole-read-through average pg/hr, reading days, active days.
- Audiobook: book length, actual persisted listening time, effective speed, reading days, active days.
- Adds Paused as a real read-through state.
- Active days include ordinary days you simply did not read.
- Explicit Paused/DNF periods are excluded; resuming the same read-through begins active-day counting again.
- Daily Progress derives page-based percentages from the page-count snapshot instead of showing meaningless 0% → 0%.
- Existing pre-v0.0.12 pause/DNF gaps cannot be reconstructed if they were never recorded.
- Preserves the Opal Treatment and existing session/progress behavior.
