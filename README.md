**English** | [中文](./README.zh-CN.md)

# TritonPlan

**A calendar-first course planner for UC San Diego — the WebReg "plan" view that the new Triton Student System (TSS) never shipped.**

**➡️ Open the planner: <https://hfjddjksaj.github.io/tritonplan/>**

TritonPlan brings back the thing every UCSD student misses: a Google-Calendar-style weekly view of your classes — times, locations, professors, sections, **and final exams** — with instant time-conflict detection. The old **WebReg** had it. The new **Triton Student System (TSS)** doesn't. So we rebuilt it — with an all-new, calendar-first interface.

> **Unofficial, student-made tool.** Not affiliated with, authorized, or endorsed by UC San Diego. It only reads the course data TSS already shows *you*, in *your own* browser, and keeps everything on *your* device. See [Disclaimer](#disclaimer) and [PRIVACY.md](./PRIVACY.md).

---

## What it is

TritonPlan has two parts that work together:

1. **A Chrome / Edge browser extension** that *passively* reads the course data TSS already displays to you and injects a small **"+ TritonPlan"** button onto each bookable section. Click it and the course jumps straight onto your planner.
2. **The planner website** (linked above) that draws your week as a calendar, flags conflicts, and lets you share or export your plan. It's a fully static site with **no backend** — nothing you do there leaves your browser.

You browse courses in TSS like you always do. TritonPlan quietly turns them into a clean weekly schedule you can actually reason about.

---

## Features

- **Weekly calendar grid** — every lecture, discussion, and lab laid out Monday–Sunday by time of day, with a live "now" line on today.
- **Time-conflict detection & highlighting** — the core value. Overlapping meetings light up so you can see clashes at a glance.
- **Finals view** — a dedicated view of your final exams in date order, with its own final-exam conflict detection (spot back-to-back or overlapping finals before you enroll).
- **Switch section-options to resolve conflicts** — pick a different lecture/discussion/lab combination for a course right in the planner and watch the conflict clear.
- **"Browsed and added courses" rail** — courses you open in TSS collect in a side rail, with a filter box, one-click add, and easy removal of the ones you don't want.
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

You can also open the planner directly — from the extension's popup, or just by visiting the [website](https://hfjddjksaj.github.io/tritonplan/).

---

## How it works: capturing the OData the server already sends you

TSS is an SAP (SAPUI5 / Fiori) web app. When you browse the Schedule of Classes, the TSS server sends your browser the course data as **OData** (JSON) responses, and the page renders them on screen.

**That's all TritonPlan needs.** The extension simply **captures those OData responses as they arrive in your browser** — it clones the data the server already sent to *you* — parses the schedules out of them, and hands the result to the planner page. It never asks the server for anything.

### Zero-ban, passive-observer design

This is the hard rule the whole product is built around:

- The extension **never talks to TSS servers**. It only observes responses the TSS page itself fetched (`response.clone()` on the page's own `fetch`/`XHR`) — it **never issues, replays, retries, prefetches, or polls** any request of its own.
- It **never automates TSS** — it never clicks TSS buttons or submits anything on your behalf. The "+ TritonPlan" button only reads data already captured and sends it to *our* planner.
- Because it generates **zero extra server traffic**, your traffic looks byte-for-byte identical to any other student's. **The server cannot distinguish a TritonPlan user from a normal student.**
- **Minimal permissions:** `storage` and `tabs`, plus host access to only `tss.ucsd.edu` (to read the data already on your screen) and the planner site (to hand that data to it). No broad web access, no analytics, no tracking.

The planner website is equally boring on purpose: a static page that computes conflicts in your browser and saves your plan to `localStorage`. Sharing compresses the whole plan into the link itself. **No backend, no accounts, nothing uploaded.**

*Curious about the internals? See the [developer guide](./docs/development.md).*

---

## Installing the extension

### From the Chrome Web Store (recommended)

**[Get TritonPlan on the Chrome Web Store](https://chromewebstore.google.com/detail/tritonplan/lnchlccmjhhpbbemlfnpldooeehcmjel)** — click **Add to Chrome**. Works in Microsoft Edge too (Edge can install straight from the Chrome Web Store).

### Manual install (load unpacked)

For Chrome or Edge (Chromium):

1. Get a built copy of the extension — either grab the release zip and unzip it, or build from source (`npm install && npm run build -w @triton/extension` → `extension/dist`).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the extension folder (the one with `manifest.json` at its root).
5. Log into TSS and open the Schedule of Classes — the **"+ TritonPlan"** buttons appear on section cards.

Developers: setup, commands, and architecture are in the [developer guide](./docs/development.md).

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
