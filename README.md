# Opal Shelf v0.0.8 — GitHub Pages frontend

Flat GitHub Pages frontend package for Opal Shelf v0.0.8.

## Install

1. Deploy the v0.0.8 Worker.
2. Confirm `/health` reports `0.0.8`.
3. Replace the GitHub repository root files with this ZIP.

No D1 migration is required.

## v0.0.8

- Adds **Edit session** to the quiet `•••` repair menu under Reading History / Edit Read-through.
- Session edits can correct date, start/end time, duration, and audiobook listening speed.
- Start/end edits recalculate duration. Direct duration edits preserve start time and shift the end time.
- Keeps Move session and Delete session.
- Hardens book-cover persistence so routine Edit Book saves do not silently clear an existing cover.
- Adds a small **Find cover** repair action in Edit Book using the existing Open Library search.
- Intentional cover removal requires the explicit Remove current cover checkbox.
- No ratings.
