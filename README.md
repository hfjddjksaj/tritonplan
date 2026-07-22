**English** | [中文](./README.zh-CN.md)

# TritonPlan

**A calendar-first course planner for UC San Diego — the WebReg "plan" view that the new Triton Student System (TSS) never shipped.**

TritonPlan brings back the thing every UCSD student misses: a Google-Calendar-style weekly view of your classes — times, locations, professors, sections, **and final exams** — with instant time-conflict detection. The old **WebReg** had it. The new **Triton Student System (TSS)** doesn't. So we rebuilt it.

> **Unofficial, student-made tool.** Not affiliated with, authorized, or endorsed by UC San Diego. It only reads the course data TSS already shows *you*, in *your own* browser, and keeps everything on *your* device. See [Disclaimer](#disclaimer) and [PRIVACY.md](./PRIVACY.md).

---

## What it is

TritonPlan has two parts that work together:

1. **A Chrome / Edge browser extension** that *passively* reads the course data TSS already displays to you and injects a small **"+ TritonPlan"** button onto each bookable section. Click it and the course jumps straight onto your planner.
2. **A standalone planner website** (React, fully static, hosted on GitHub Pages, **no backend**) that draws your week as a calendar, flags conflicts, and lets you share or export your plan.

You browse courses in TSS like you always do. TritonPlan quietly turns them into a clean weekly schedule you can actually reason about.

---

## Features

- **Weekly calendar grid** — every lecture, discussion, and lab laid out Monday–Sunday by time of day.
- **Time-conflict detection & highlighting** — the core value. Overlapping meetings light up so you can see clashes at a glance.
- **Finals view** — a dedicated view of your final exams in date order, with its own final-exam conflict detection (spot back-to-back or overlapping finals before you enroll).
- **Switch section-options to resolve conflicts** — pick a different lecture/discussion/lab combination for a course right in the planner and watch the conflict clear.
- **"Browsed and added courses" rail** — courses you open in TSS collect in a side rail, with a filter box so you can quickly find and pull the ones you want into your plan.
- **Share via URL + JSON export/import** — your entire plan is encoded into a shareable link (compressed into the URL, no server needed) and can be exported/imported as a JSON file — portable to any browser or friend.
- **Jump back to TSS** — click any block on the calendar to reopen that exact course in TSS.
- **Local-first** — your plan lives in your browser's `localStorage` and in shareable URLs. Nothing is uploaded.

---

## Screenshots

*Screenshots are TBD — see [`docs/screenshots/`](./docs/screenshots/).*

<!-- ![Weekly calendar with a conflict highlighted](docs/screenshots/calendar.png) -->
<!-- ![Finals view](docs/screenshots/finals.png) -->
<!-- ![The "+ TritonPlan" button injected on a TSS section](docs/screenshots/tss-button.png) -->

---

## How to use

1. **Install the extension** (see [Installing the extension](#installing-the-extension) below).
2. **Browse a course in TSS** as usual (Schedule of Classes).
3. On the section you want, click **"+ TritonPlan"**.
4. You land on the **TritonPlan calendar** with that section placed for you.
5. **Arrange your sections** to avoid conflicts — switch a course's section-option if two classes clash, and check the **Finals** view.
6. **Share or export** your plan when you're happy with it.

You can also open the planner directly (without adding anything) from the extension's popup, or just visit the planner website — it ships with a small sample schedule so you can try the interface.

---

## How it works

TSS is built on **SAP Student Lifecycle Management (SLcM)** — a SAPUI5 / Fiori app backed by **OData** services. TritonPlan is designed around one hard rule:

### Zero-ban, passive-observer design

**The extension never talks to TSS servers.** It is a *pure passive observer*:

- It **intercepts** the OData responses the TSS page **already fetched** (via `response.clone()` on the page's own `fetch`/`XHR`). It **never issues, replays, retries, prefetches, or polls** any request of its own.
- It **never automates** TSS — it never clicks TSS buttons or submits anything. The "+ TritonPlan" button only reads data already captured and sends it to *our* planner.
- Because it generates **zero extra server traffic** and drives nothing, **the server cannot distinguish a TritonPlan user from a normal student** browsing the site. From TSS's point of view, your traffic is byte-for-byte identical to anyone else's.
- **Minimal permissions:** `storage` and `tabs`, plus host access to only `tss.ucsd.edu` (to read the data already on your screen) and the planner site (to hand that data to it). No broad web access, no analytics, no tracking.

This is the deliberate design red line throughout the codebase. Your data stays on your device.

### Data flow

1. **Capture (extension, on `tss.ucsd.edu`):** a page-context interceptor observes the OData responses the Schedule-of-Classes app loads and forwards each body to the extension's background worker, which stores it locally.
2. **Parse & normalize:** the extension parses SAP's pre-formatted `Sched` string into weekly **meetings** plus an optional **final exam**, and groups SAP **EventPackages** (denormalized as one row per Event × EventPackage) into bookable **section-options** — e.g. a lecture + one specific lab + discussion. TBA/async components with no placeable time are kept aside as "unscheduled".
3. **Bridge to the website:** when you click **"+ TritonPlan"** (or open the planner), the extension delivers the data to the planner page via `window.postMessage`, using two message types: `courses` (the pool of everything you've browsed) and `plan-add` (add this exact section now).
4. **Plan (website):** the planner is a static single-page app. It merges incoming courses, draws the calendar, computes conflicts, and persists your plan in `localStorage`. Sharing encodes the whole plan into the URL hash (lz-string compressed); export/import uses plain JSON.

The normalized data model that the extension produces and the website consumes lives in [`shared/src/types.ts`](./shared/src/types.ts). The reverse-engineering notes for TSS are in [`docs/tss-recon/tss-api-notes.md`](./docs/tss-recon/tss-api-notes.md).

### A recreation, not a copy

TritonPlan reproduces WebReg's *plan functionality* — but not its dated interface. The UI is all-new and calendar-first: a calm navy/gold "planning surface," monospace for schedule data, and **conflicts as the signature visual state**. It looks nothing like old WebReg; it just finally does what WebReg did.

---

## Installing the extension

### From the Chrome Web Store (recommended, when published)

Search for **TritonPlan** in the Chrome Web Store (also works in Microsoft Edge) and click **Add**. *(Store listing pending.)*

### Developer install (load unpacked)

For Chrome or Edge (Chromium), from a built copy of the extension:

1. Build the extension so that `extension/dist/` exists (its `manifest.json` sits at the root of `dist`).
   ```
   npm install
   npm run build -w @triton/extension
   ```
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the `extension/dist` folder.
5. Log into TSS and open the Schedule of Classes — the **"+ TritonPlan"** buttons appear on section cards.

> The current build points the planner bridge at the local dev planner (`http://localhost:5173`). For a production install the planner URL is baked into the extension before it's zipped for the store — see [`docs/deployment.md`](./docs/deployment.md).

---

## Running the planner website (for developers)

The planner is a standard Vite + React app.

```
npm install
npm run dev -w @triton/web      # local dev server (http://localhost:5173)
npm run build -w @triton/web    # static build → web/dist (base './', subpath-safe)
```

The build is a static site — deploy `web/dist` to GitHub Pages (or any static host). Details in [`docs/deployment.md`](./docs/deployment.md).

---

## Repository layout

```
plan/
├── shared/         Shared TypeScript: the normalized data model + conflict/time logic
│   └── src/types.ts     The contract between extension and website
├── web/            The planner website (React + Vite, static)
│   └── src/             Calendar UI, planner state, share/export, TSS deep links
├── extension/      The Chrome/Edge MV3 extension
│   └── src/             Passive interceptor, TSS parser, background worker, popup
└── docs/           TSS reverse-engineering notes + deployment guide
    └── screenshots/     (TBD)
```

It's an npm workspaces monorepo (`shared`, `web`, `extension`).

---

## Browser & platform support

- **Extension:** Chrome and Edge (Chromium), Manifest V3 — one package runs identically on Windows, macOS, Linux, and ChromeOS. Firefox and Safari are possible future targets, not in scope yet.
- **Planner website:** any modern browser on any OS (it's just a static site).

---

## Privacy

TritonPlan collects **no** personal data and has **no** backend. Everything stays in your browser. Read the full [Privacy Policy](./PRIVACY.md).

---

## Credits

Built with the help of **Claude AI** — Anthropic's **Claude Code**.

---

## Disclaimer

TritonPlan is an **unofficial, student-made tool** and is **not affiliated with, authorized, or endorsed by UC San Diego**. It only reads course data that is already displayed to you in your own browser and stores it locally on your device; it collects and transmits **no** personal data. It is provided **as-is, with no warranty — use at your own risk**. You are responsible for using it in accordance with UCSD's Acceptable Use Policy and all applicable UCSD policies.

## License

MIT — see the `license` field in [`package.json`](./package.json).
