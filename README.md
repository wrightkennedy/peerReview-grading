# Blackboard Grade Processing Tool

Local-first browser app for Teaching Assistants to process Blackboard gradebook CSV workflows.

## What this app does

1. **Task 1: Attendance Verification for In-class Assignment**
2. **Task 2: Summary of Peer Review Assessment**
   - Summary mode (`PeerReviewSubmissions.csv`)
   - Raw mode (MS Forms raw + assignments + owner map)
3. **Task 3: Peer Review Participation**
   - Assignments mode
   - Raw mode

## Core guarantees

- CSV processing runs entirely in the browser.
- No backend and no file upload API for grading data.
- Main output preserves Blackboard gradebook columns and row order.
- Exports are separate files: main CSV, issues CSV, per-TA issue CSVs, audit JSON.
- "Download All Outputs" exports a ZIP bundle.

## Task details

### Task 1: Attendance Verification for In-class Assignment

**Required inputs**
- Blackboard Gradebook CSV (attendance/discussion assignment)
- Attendance CSV

**Processing**
- Left-join attendance onto gradebook by configured join keys.
- For rows with `Needs Grading` and not `Present`, set assignment score to `0`.
- Write configured attendance feedback text to gradebook feedback field.

**Outputs**
- `<gradebook_stem>_NoAttendance.csv`
- `<gradebook_stem>_NoAttendance_Audit.json`

### Task 2: Summary of Peer Review Assessment

**Modes**
- **Summary mode**: gradebook + summarized peer-review CSV (+ optional TA crosswalk)
- **Raw mode**: gradebook + raw forms CSV + `PeerReviewAssignments.csv` + owner map (`PeerReviewSubmissions.csv`) (+ optional TA crosswalk)

**Key behavior**
- Chapter filtering support (`chXX`) with defaults.
- Supports rubric-weighted scoring and overall-average scoring.
- Manual join overrides for missing gradebook join keys.
- Range-score issue handling with configurable threshold.
- Integrity flags are listed for TA review.
- Fairness handling:
  - Summary mode fairness option is locked (summary source is treated as already fairness-filtered).
  - Raw mode can include/exclude fairness-flagged reviews in score calculations.
- Raw mode uses authoritative join path `raw.ReviewToken -> assignments.Token`.
- Relative `PaperLink` values (starting with `/`) are normalized to
  `https://emailsc.sharepoint.com/...` in issue outputs.

**Outputs**
- Main Blackboard CSV
- Issues CSV
- Per-TA issues CSV files
- Audit JSON

### Task 3: Peer Review Participation

**Modes**
- **Assignments mode**: compute from `PeerReviewAssignments.csv` status/timestamps/fairness
- **Raw mode**: compute completion/fairness from raw forms, joined through assignment tokens

**Key behavior**
- Required review count, assignment points, late penalty controls.
- Due date/time controls with timezone handling.
- Optional class schedule window (default Tue/Thu 8:30-9:20 Eastern) to flag in-class submissions.
- Fairness and class-time credit exclusions reflected in feedback and issues.
- Duplicate token handling keeps first submission for scoring and flags duplicates.

**Outputs**
- Main Blackboard CSV
- Issues CSV
- Per-TA issues CSV files
- Audit JSON

## Quick start

### Prerequisites

- Node.js 20+
- npm 10+

### Install and run

```bash
npm install
npm run dev
```

### Validation

```bash
npm run lint
npm test
npm run build
```

## Deployment (GitHub Pages)

Deployment workflow: `.github/workflows/deploy-pages.yml`

Triggers:
- Push to `main`
- Published release
- Manual workflow dispatch

Requirements in GitHub repo settings:
- `Settings -> Pages -> Source`: **GitHub Actions**
- `Settings -> Actions -> General -> Workflow permissions`: **Read and write permissions**

The Vite base path is derived from `GITHUB_REPOSITORY` for production builds, so
the app serves correctly from `https://<user>.github.io/<repo>/`.

## Project structure

- `src/` application code
- `src/processors/` task processing engines
- `src/lib/` CSV, join, math, text, audit helpers
- `tests/` test suite
- `tests/fixtures/` sanitized fixture data (no real student records)
- `.github/workflows/` CI/CD workflows

## Privacy and security notes

- Runtime is local-first in the browser; grading files are not sent to app servers.
- CSP in `index.html` restricts outbound `connect-src`.
- No analytics or telemetry pipeline is configured for grading events.
- Do not commit real student CSVs to the repository.

## Troubleshooting

- If GitHub Pages deploy fails on `Setup Pages`, verify the two repo settings above.
- If Blackboard import fails, verify that output header names exactly match the original gradebook.
- If joins fail, use Field Mapping and manual join overrides to resolve missing keys.
