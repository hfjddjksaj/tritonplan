# Privacy Policy — TritonPlan

**Last updated: 2026-07-21**

TritonPlan is an unofficial, student-made course-planning tool for UC San Diego. It is **not affiliated with, authorized, or endorsed by UC San Diego**.

**Short version: TritonPlan collects nothing. There is no backend, no account, no analytics, and no tracking. Everything stays in your browser, on your device.**

---

## What we collect

**Nothing.** TritonPlan has no servers, no database, and no account system. We do not collect, receive, store, sell, or transmit any personal information, browsing history, or course data. We cannot see what you plan, because none of it ever leaves your device.

## How your data is handled

TritonPlan has two components, and neither one sends your data anywhere:

- **The browser extension** is a *passive observer*. On `tss.ucsd.edu`, it reads the course data that the Triton Student System (TSS) has **already loaded into your browser** and displayed to you. It does this by observing the page's own network responses — it **never makes its own requests to TSS**, never automates the site, and never sends your data to us or any third party. The captured course data is kept locally in the browser's extension storage and is handed only to the TritonPlan planner page you open.
- **The planner website** is a fully static page with no backend. It stores your plan in your browser's `localStorage` on your own device. When you use the **Share** feature, your plan is encoded directly into the URL link — it is not uploaded to any server; it only travels if *you* choose to send that link to someone. The **Export** feature saves a JSON file to your own computer.

Because there is no server involved, deleting your data is entirely in your hands: clear the extension's storage / the site's `localStorage` (or uninstall the extension), and it's gone.

## Permissions the extension requests, and why

The extension asks for the minimum it needs to do its job:

| Permission | Why it's needed |
|---|---|
| `storage` | To save the course data you've browsed and your plan locally in your browser, so they persist between sessions. Local only — never uploaded. |
| `tabs` | To open or focus the TritonPlan planner tab when you click "+ TritonPlan" or open the planner from the extension popup. |
| Host access to `tss.ucsd.edu` | To read the course data TSS has already displayed to you, so it can be shown on the calendar. Read-only and passive — no extra requests are made to TSS. |
| Host access to the planner website | To deliver the course data from the extension to the planner page you open. |

The extension requests **no** broad web access and **no** access to any other site.

## Third parties

None. TritonPlan uses no analytics, no advertising, no trackers, and no third-party services. No data is shared with anyone, because no data is collected.

## Children's privacy

TritonPlan is intended for UC San Diego students. It collects no personal information from anyone, including children.

## Changes to this policy

If this policy ever changes, the updated version will be posted in this file in the project repository, with a new "Last updated" date.

## Contact

Questions about this policy: **duzijue@gmail.com**

---

*Disclaimer: TritonPlan is provided as-is, with no warranty. It only reads data already displayed to you in your own browser and stores it locally; it collects and transmits no personal data. Use at your own risk, and in accordance with UC San Diego's Acceptable Use Policy.*
