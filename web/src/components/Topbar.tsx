import { useRef, useState, type ReactNode } from 'react';
import type { PlanState } from '@triton/shared';
import { PRODUCT_NAME } from '../lib/brand';
import { useClickAway } from '../hooks/useClickAway';
import { ShareMenu } from './ShareMenu';
import { Trident, Upload, Trash, Link, ChevronDown } from './icons';

interface Props {
  termLabel: string;
  units: number;
  /** Viewing someone else's plan — editing actions (Clear) hide. */
  readOnly: boolean;
  /** The named-plans dropdown, rendered next to the brand. */
  planSwitcher?: ReactNode;
  /** The student's own appointment-times capsule, rendered before the unit pill. */
  apptSlot?: ReactNode;
  /** The plan on screen, for the Share menu (link + QR). */
  sharePlan: PlanState;
  onFlash: (msg: string) => void;
  onImportText: (text: string) => void;
  onImportLink: (text: string) => boolean;
  onReset: () => void;
}

export function Topbar({
  termLabel,
  units,
  readOnly,
  planSwitcher,
  apptSlot,
  sharePlan,
  onFlash,
  onImportText,
  onImportLink,
  onReset,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [linkText, setLinkText] = useState('');
  const importRef = useRef<HTMLDivElement>(null);
  useClickAway(importOpen, importRef, () => setImportOpen(false));

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(onImportText);
    e.target.value = ''; // allow re-importing the same file
  };

  const submitLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (onImportLink(linkText)) {
      setLinkText('');
      setImportOpen(false);
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <Trident className="brand__mark" size={22} />
        <span>{PRODUCT_NAME}</span>
        <span className="brand__sub">· UCSD</span>
      </div>

      {planSwitcher}

      <div className="topbar__term">
        <span className="eyebrow">Term</span>
        <span className="topbar__term-label">{termLabel}</span>
      </div>

      <div className="topbar__spacer" />

      {apptSlot}

      <div className="unit-pill" title="Total units of added courses">
        <span className="unit-pill__n mono">{units}</span>
        <span className="unit-pill__label">units</span>
      </div>

      <div className="topbar__actions">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFile}
          hidden
        />
        {!readOnly && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={onReset}
            title="Remove every course from the plan"
          >
            <Trash size={15} /> Clear
          </button>
        )}

        <div className="menu-wrap" ref={importRef}>
          <button
            type="button"
            className="btn btn--sm"
            aria-haspopup="menu"
            aria-expanded={importOpen}
            onClick={() => setImportOpen((v) => !v)}
          >
            <Upload size={15} /> Import <ChevronDown size={12} />
          </button>
          {importOpen && (
            <div className="menu" role="menu">
              {/* Upload JSON — shelved 2026-07-25 together with Export as JSON (see
                  ShareMenu). Full share links now carry the whole plan; restore both
                  entries together if JSON round-tripping ever comes back.
              <button
                type="button"
                className="menu__item"
                role="menuitem"
                onClick={() => {
                  setImportOpen(false);
                  fileRef.current?.click();
                }}
              >
                <span className="menu__item-title">
                  <Upload size={14} /> Upload JSON file
                </span>
                <span className="menu__item-desc">
                  A plan exported from {PRODUCT_NAME}. It opens read-only, next to your own plan —
                  save it as yours if you want to edit it.
                </span>
              </button>
              */}
              <div className="menu__item menu__item--static">
                <span className="menu__item-title">
                  <Link size={14} /> Paste a share link
                </span>
                <form className="menu__linkrow" onSubmit={submitLink}>
                  <input
                    className="menu__input"
                    type="text"
                    placeholder="https://…#p=…"
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    aria-label="Share link"
                  />
                  <button type="submit" className="btn btn--sm">
                    Open
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>

        <ShareMenu plan={sharePlan} onFlash={onFlash} />
      </div>
    </header>
  );
}
