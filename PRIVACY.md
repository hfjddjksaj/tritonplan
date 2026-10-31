# Privacy Policy — TritonPlan

**Effective date: 2026-10-30**

TritonPlan is an unofficial, student-made course-planning tool for UC San Diego. It is **not affiliated with, authorized, or endorsed by UC San Diego**.

**Short version: you sign in, and your plans are stored on our server so they follow you across devices. We keep only what the planner needs, we never sell it, and there are no ads, no analytics, and no third-party trackers. You can delete your account and everything in it at any time.**

This policy covers the planner website at `https://tritonplan.cn` and the TritonPlan browser extension.

---

## What we collect

When you create an account and use the planner, we store:

- **Account details:** your email address and whether it is verified. If you sign up with a password, we store it only as an irreversible hash (argon2id) — never the password itself. If you use **Sign in with Google**, we also store Google's account ID (`sub`). We request only the `openid`, `email`, and `profile` scopes, and we do **not** store your name or profile photo.
- **Your plans:** terms and plans (the courses you added, the sections you chose, plan names).
- **Browsed courses:** the courses you looked at on TSS that the extension captured (the "Browsed" pool in the planner).
- **Enrollment marks:** which courses you marked as booked, waitlisted, or enrolled.
- **Appointment times:** your TSS enrollment appointment windows (First Pass, Second Pass, …).
- **Share links made before 2026-10-30:** TritonPlan no longer creates share links. A link made earlier is a snapshot of one plan and its name stored on our server (see "Calendar link and older share links" below).
- **Calendar link:** if you add a plan to Apple or Google Calendar (Share in the planner, or Calendar subscription in the Account menu), we store a secret code for your private calendar link and which plan you picked for the calendar in each term.

A few things stay only in your browser (`localStorage`) and are never sent to us: interface preferences (such as the calendar view) and plans other people have shared with you — unless you move them from the old site, which saves them to your account.

## Where it is stored

On a single server hosted by Tencent Cloud in Silicon Valley, United States. Nightly backups of the server's data are kept for at most 14 days and then deleted on a rolling basis.

## Who can see it

Only you, in the sense that no other user can see your data. The person who runs TritonPlan has technical access to the server and its database, and uses it only to keep the service running and to fix problems. The other exceptions are your calendar link, and any share link made before TritonPlan stopped offering them. Whoever holds one of them can see what it points to, as described in the next section.

## Calendar link and older share links

**Calendar link.** When you add a plan to Apple or Google Calendar, you get a private address of the form `https://tritonplan.cn/api/cal/<secret>.ics` (the secret is 43 random characters). Anyone who has this address can see the plans you picked for the calendar: your classes, sections, rooms, instructors, final exams and midterms. Treat it like a password. You can reset the link at any time, which stops the old address working immediately. The link is deleted when you delete your account. Calendar apps such as Apple Calendar and Google Calendar fetch the address from their own servers, so if you subscribe in Google Calendar, Google's servers receive that calendar content.

**Older share links.** Until 2026-10-30 the planner could make short share links like `https://tritonplan.cn/s/<code>`; it no longer does. Each one stored a snapshot of one plan on our server, together with its name. The snapshot contains only the plan itself (term, courses, chosen sections, colors); your booked / waitlisted / enrolled marks, appointment times and the rest of your account were never part of it. Anyone who has such a link can still open the snapshot; the page that serves it returns only the snapshot's name, the plan and when it was created, nothing else about you. The snapshot is deleted when the account that made it is deleted; to have one removed sooner, contact us (below). Links that look like `#p=…` work differently: they carry the plan inside the link itself and never touch our server, so we cannot turn them off.

## Professor ratings

TritonPlan shows RateMyProfessors (RMP) ratings next to instructors. About once a month our server downloads RMP's public list of UC San Diego teachers, with their average ratings, and keeps it in our database. When you look up ratings in the planner, your browser sends only the instructors' names to our own server (you must be signed in), and the server answers from that stored list. Nothing about you is sent to RMP. If you click through to RMP, you leave TritonPlan and RMP's own privacy policy applies on its site.

## The extension

The extension is a *passive observer*. On `tss.ucsd.edu`, it reads the course data that the Triton Student System (TSS) has **already loaded into your browser** and displayed to you, by observing the page's own network responses. It **never makes its own requests to TSS**, never automates the site, and never sends anything to us itself. It keeps the captured courses in the browser's extension storage and passes them to the TritonPlan planner page open in your browser; the planner then saves them to your account. The extension doesn't read your TritonPlan account details.

### Permissions the extension requests, and why

| Permission | Why it's needed |
|---|---|
| `storage` | To keep the captured course data locally in your browser until the planner picks it up. |
| `tabs` | To open or focus the TritonPlan planner tab when you click "+ TritonPlan" or open the planner from the extension popup. |
| Host access to `tss.ucsd.edu` | To read the course data TSS has already displayed to you. Read-only and passive — no extra requests are made to TSS. |
| Host access to `tritonplan.cn` | To hand the captured courses from the extension to the planner page you open. |

The extension requests **no** broad web access and **no** access to any other site.

## Cookies

The planner sets one sign-in session cookie, `tp_session`, which lasts 30 days and is renewed while you use the site. During Google sign-in it also sets short-lived cookies that exist only to complete that sign-in. We use no advertising or analytics cookies.

## Logs and IP addresses

We don't log the pages you visit. Like any web server, ours sees your IP address: it is held in memory for up to an hour to limit sign-in attempts and repeated requests to the public share and calendar addresses, and it can appear in the server's error logs, which are deleted automatically within 14 days.

## Third parties

- **Tencent Cloud** hosts the server.
- **Resend** sends our verification and password-reset emails, so it receives your email address for that purpose.
- **Google** handles Google sign-in, if you choose it.

We do not sell your data or share it for advertising. There are no ads, no analytics, and no third-party trackers.

## Your control and deleting your data

In the planner, open the Account menu and choose **Delete account**. This immediately removes your account, every plan, your browsed courses, your booked / waitlisted / enrolled marks, your appointment windows, all of your share links and your calendar link. Server backups made before the deletion roll off within 14 days. Old `#p=…` share links carry their snapshot inside the link itself, so they keep working for whoever has them. You can also remove the extension's locally stored data by uninstalling the extension.

The old site at `https://hfjddjksaj.github.io/tritonplan/` is now a migration page. It reads the plans saved in that browser and hands them to the new site only when you click the migrate button; it never deletes them.

## Children's privacy

TritonPlan is intended for UC San Diego students and is not directed at children.

## Changes to this policy

If this policy changes, the updated version will be posted at `https://tritonplan.cn/privacy.html` and in this file in the project repository, with a new effective date.

## Contact

Questions about this policy: open an issue at <https://github.com/hfjddjksaj/tritonplan/issues>.

---

*Disclaimer: TritonPlan is provided as-is, with no warranty. Use at your own risk, and in accordance with UC San Diego's Acceptable Use Policy.*
