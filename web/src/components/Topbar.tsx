import { useRef } from 'react';
import { PRODUCT_NAME } from '../lib/brand';
import { Trident, Share, Download, Upload } from './icons';

interface Props {
  termLabel: string;
  units: number;
  onShare: () => void;
  onExport: () => void;
  onImportText: (text: string) => void;
}

export function Topbar({ termLabel, units, onShare, onExport, onImportText }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(onImportText);
    e.target.value = ''; // allow re-importing the same file
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
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => fileRef.current?.click()}
          title="Import a plan from a JSON file"
        >
          <Upload size={15} /> Import
        </button>
        <button type="button" className="btn btn--sm" onClick={onExport} title="Download plan as JSON">
          <Download size={15} /> Export
        </button>
        <button type="button" className="btn btn--sm btn--primary" onClick={onShare}>
          <Share size={15} /> Share
        </button>
      </div>
    </header>
  );
}
