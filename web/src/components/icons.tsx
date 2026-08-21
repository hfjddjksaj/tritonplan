/** Inline SVG icons — no network, no icon-font dependency. */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
function base({ size = 16, ...props }: P) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

/** Triton trident — the brand mark. */
export function Trident({ size = 20, ...props }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 3v18" />
      <path d="M5 4v3a7 7 0 0 0 14 0V4" />
      <path d="M5 4l-1.5 2M19 4l1.5 2" />
      <path d="M9 21h6" />
    </svg>
  );
}

export const Search = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
);
export const Share = (p: P) => (
  <svg {...base(p)}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);
export const Warning = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);
export const Trash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
  </svg>
);
export const Clock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const Calendar = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 3v4M16 3v4" />
  </svg>
);
export const Cap = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4 2 9l10 5 10-5-10-5Z" />
    <path d="M5 11v5c0 1 3 3 7 3s7-2 7-3v-5" />
  </svg>
);
/** Pen over a line — exams/writing (the Midterms tab). */
export const PenLine = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
export const Plus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const Minus = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
);
export const X = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const Check = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12 5 5 9-11" />
  </svg>
);
export const Pencil = (p: P) => (
  <svg {...base(p)}>
    <path d="M17 3.5a2.1 2.1 0 0 1 3 3L7.5 19 3 20.5 4.5 16Z" />
  </svg>
);
export const Copy = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
export const Link = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);
export const Eye = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);
export const ChevronDown = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
export const External = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 4h6v6" />
    <path d="M20 4 10 14" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
export const List = (p: P) => (
  <svg {...base(p)}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);
export const QrCode = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M17.5 17.5v.01M21 21v.01" />
  </svg>
);
export const MapPinIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);
/** A north needle — the map's compass, drawn as a control, not on the canvas. */
export const Compass = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2.5 16.5 12h-9L12 2.5Z" fill="currentColor" stroke="none" />
    <path d="M7.5 12h9L12 21.5 7.5 12Z" fill="none" strokeWidth="1.6" />
  </svg>
);

/**
 * Exclamation mark drawn as geometry rather than typed as a character.
 *
 * A "!" glyph centres by its line box, not by its ink: the descender space below the
 * baseline is empty, so the mark rides high inside any box you centre it in, by a
 * fraction that changes with the font. Drawing it makes the ink itself the thing
 * being centred. Bar and dot fill the viewBox exactly, top to bottom.
 */
/**
 * The road-sign warning mark: a bang inside a triangular frame, all one colour.
 * Drawn rather than typed for the reason `Bang` below exists — a "!" is a
 * character, so it aligns to a line box and sits high in whatever you centre it
 * in. The bar and dot here are geometry inside the same viewBox as the frame,
 * so they cannot drift when the font changes.
 */
export function WarnTriangle({ size = 13, ...props }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.32 3.1a1.94 1.94 0 0 1 3.36 0l9.06 15.7a1.94 1.94 0 0 1-1.68 2.9H2.94a1.94 1.94 0 0 1-1.68-2.9zM12 8.15a1.3 1.3 0 0 0-1.3 1.37l.26 4.62a1.04 1.04 0 0 0 2.08 0l.26-4.62A1.3 1.3 0 0 0 12 8.15m0 7.75a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6"
      />
    </svg>
  );
}

/**
 * A bang inside a circle — the mark beside Booked when TSS has you in a
 * different package than the plan shows.
 *
 * Two shapes were rejected before this one, both for belonging to no family.
 * A solid free-drawn bang was the only filled bespoke glyph in the app, where
 * every other warning is a 2px stroke (`Warning` on conflicts, blocks, finals);
 * and a triangle — the obvious alternative — is already taken by `WarnTriangle`
 * for waitlist-only sections, which would have put one silhouette on two
 * unrelated meanings. A circle is the shape left that says "read this" without
 * claiming either. `r=9` is `Clock`'s circle, deliberately.
 *
 * Two numbers here are measured, not chosen. The ink runs from y=6.45 (the
 * bar's round cap above 7.6) to y=17.55 (the dot's cap below 16.4), centring
 * on exactly 12.00 — a "!" typed as a character cannot do that, because it
 * aligns to a line box whose descent below the baseline is empty, so it rides
 * high by a fraction that moves with the font. And the badge renders this at
 * an EVEN size inside an even content box, so both side margins are whole
 * pixels: the glyph this replaced was 3.14px wide, landing on no pixel
 * boundary at all, and read as shifted right however it was centred.
 *
 * `strokeWidth` 2.3 rather than the shared 2: at 14px that is a 1.34px stroke,
 * which is what `base()`'s 2 gives at its own 16px call size. Same ink, one
 * size down.
 */
export function WarnCircle({ size = 14, ...props }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.6v5" />
      <path d="M12 16.4h.01" />
    </svg>
  );
}
