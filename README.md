# Blackboard Grade Processing Tool

Local-first browser tool for Teaching Assistants to process Blackboard gradebook CSVs for three workflows:

1. Attendance Verification for In-class Assignment
2. Summary of Peer Review Assessment (summarized and raw modes)
3. Peer Review Participation

## Key Guarantees

- CSV processing runs entirely in-browser.
- No backend and no data upload API calls.
- Main output CSV preserves input gradebook headers and row order.
- Separate downloads for main output, issues, per-TA issues, and JSON audit.

## Tech Stack

- React + TypeScript + Vite
- Papa Parse (CSV parsing/serialization)
- Luxon (timezone and due-date handling)
- Web Worker for CSV parsing responsiveness

## Development

```bash
npm install
npm run dev
```

Run tests:

```bash
npm test
```

Build production assets:

```bash
npm run build
```

## Deployment (GitHub Pages)

- The workflow in `.github/workflows/deploy-pages.yml` builds and deploys `dist/` to GitHub Pages on release publish and on pushes to `main`.
- Vite base path is auto-derived from `GITHUB_REPOSITORY` in production builds.

## Input Fixtures

Sample fixtures are in `samples/` for local validation only. They are not imported by the app build.

## Security Notes

- CSP in `index.html` blocks outbound `connect-src` requests.
- The app does not use `fetch` for processing.
- TA crosswalk and other data are loaded by file upload only; nothing is hard-coded.
