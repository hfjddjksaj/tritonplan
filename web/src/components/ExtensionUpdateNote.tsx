import { useState } from 'react';
import { loadExtUpdateNoteDismissed, saveExtUpdateNoteDismissed } from '../lib/storage';

const NOTE =
  'After the TritonPlan extension updates, Chrome may switch it off until you allow its new site. ' +
  'If the + TritonPlan button disappears from TSS, open chrome://extensions and turn TritonPlan back on.';

/**
 * The extension's move to tritonplan.cn adds a site to its permissions, and
 * Chrome may switch an updated extension off until the student allows it.
 * Shown on this browser until dismissed once.
 */
export function ExtensionUpdateNote() {
  const [shown, setShown] = useState(() => !loadExtUpdateNoteDismissed());
  if (!shown) return null;
  return (
    <div className="notebar" role="status">
      <span className="notebar__text">{NOTE}</span>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => {
          saveExtUpdateNoteDismissed();
          setShown(false);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
