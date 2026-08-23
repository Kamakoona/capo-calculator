# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Korean-language web app ("카포 계산기" / Capo Calculator) for guitarists. A user uploads a photo
of a chord sheet (코드보), the app recognizes the chords via in-browser OCR, and the user specifies
a different chord shape they want to use for the first measure. The app then calculates the guitar
capo fret needed so that shape sounds like the original pitch, and transposes every subsequent chord
in the progression to match. Core design constraint, matching the spirit of similar tools in this
family of apps: **nothing is ever uploaded to a server** — the image, OCR, and all chord math run
entirely client-side in the browser.

## Commands

Run locally:
```bash
python -m venv .venv
.venv\Scripts\activate      # Windows; use `source .venv/bin/activate` on Linux/macOS
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8001
```
Then open http://127.0.0.1:8001.

On Windows, `run.bat` automates venv creation, dependency install, and launch (double-click it).

There is no test suite, linter, or type-checker configured in this repo.

## Architecture

The backend (FastAPI, `app/main.py`) is intentionally minimal: it only serves the static frontend
and a health check.
- `GET /` → `static/index.html`
- `GET /api/health` → `{"ok": true}` (used as `render.yaml`'s health check path)
- `/static` is mounted for `static/*` assets

**All logic runs in the browser**, in `static/app.js`:
- **OCR**: an uploaded image is recognized with Tesseract.js (loaded from a CDN, `eng` language
  model). Word bounding boxes from the OCR result are grouped into rows (by y-center proximity),
  then sorted left-to-right within each row, to reconstruct the chords in reading order.
- **Chord parsing**: `CHORD_RE` matches a root note (`A`–`G` with optional `#`/`♯`/`b`/`♭`), an
  optional quality suffix (built from the `QUALITIES` list — `m`, `7`, `maj7`, `sus4`, `add9`, `dim`,
  `aug`, composite forms like `7sus4`, etc.), and an optional slash-bass note (`/F#`). Tokens that
  don't match are discarded during OCR extraction but can still be typed manually.
  `QUALITIES` is sorted longest-first and every entry is regex-escaped (`+` in `aug`'s `+` spelling
  is a real regex metacharacter — this bit us once, see the escaping in `capo.js`/`app.js`) before
  being joined into the alternation.
- **Editable chip list**: OCR results (or manually typed chords, split on whitespace/commas) populate
  an editable, ordered list of chord "chips" — the user can fix misreads, delete, or append entries.
  This list's order is the playback order used for transposition.
- **Capo math**: given the original first chord's root semitone `Y` and the user's desired target
  shape's root semitone `X`, the capo fret is `N = (Y - X) mod 12`. Every other chord in the list is
  then transposed by `-N` semitones (root and slash-bass, quality preserved) to get the new shape to
  play at that capo position. Flat vs. sharp spelling in the output follows the target chord's own
  spelling, falling back to the original chord's spelling when the target is spelled naturally.

## Deployment

Deployed to Render via `render.yaml` (Python 3.12.10 runtime, `pip install -r requirements.txt`,
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`). `Procfile` provides the equivalent start command
for other PaaS targets. Since all processing is client-side, the deployed server only needs to serve
static files — there's no server-side chord/OCR logic, and `.env.example` reflects that no server env
vars are needed.
