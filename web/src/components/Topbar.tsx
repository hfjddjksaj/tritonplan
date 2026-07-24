import { useEffect, useRef, useState } from 'react';
import { PRODUCT_NAME } from '../lib/brand';
import { Trident, Share, Download, Upload, Trash, Link, ChevronDown } from './icons';

interface Props {
  termLabel: string;
  units: number;
  /** Viewing someone else's plan — editing actions (Clear) hide. */
  readOnly: boolean;
  onCopyLink: () => void;
  onExportJson: () => void;
  onImportText: (text: string) => void;
  onImportLink: (text: string) => boolean;
  onReset: () => void;
}

/** Close an open dropdown when clicking anywhere outside it. */
function useClickAway(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, ref, close]);
}

export function Topbar({
  termLabel,
  units,
  readOnly,
  onCopyLink,
  onExportJson,
  onImportText,
  onImportLink,
  onReset,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [linkText, setLinkText] = useState('');
  const shareRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLDivElement>(null);
  useClickAway(shareOpen, shareRef, () => setShareOpen(false));
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

      <div className="topbar__term">
        <span className="eyebrow">Term</span>
        <span className="topbar__term-label">{termLabel}</span>
      </div>

      <div className="topbar__spacer" />

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

        <div className="menu-wrap" ref={shareRef}>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            aria-haspopup="menu"
            aria-expanded={shareOpen}
            onClick={() => setShareOpen((v) => !v)}
          >
            <Share size={15} /> Share <ChevronDown size={12} />
          </button>
          {shareOpen && (
            <div className="menu menu--right" role="menu">
              <button
                type="button"
                className="menu__item"
                role="menuitem"
                onClick={() => {
                  setShareOpen(false);
                  onCopyLink();
                }}
              >
                <span className="menu__item-title">
                  <Link size={14} /> Copy link
                </span>
                <span className="menu__item-desc">
                  A quick snapshot to send — carries only the selected sections. The receiver can
                  view it, not edit it.
                </span>
              </button>
              <button
                type="button"
                className="menu__item"
                role="menuitem"
                onClick={() => {
                  setShareOpen(false);
                  onExportJson();
                }}
              >
                <span className="menu__item-title">
                  <Download size={14} /> Export as JSON
                </span>
                <span className="menu__item-desc">
                  The complete plan, every section option included. To open it: click Import →
                  upload the file, and the plan is right there.
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
