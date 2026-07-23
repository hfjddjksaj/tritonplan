import { useEffect } from 'react';
import { canonicalBuilding, googleMapsLink, UCSD_CAMPUS_MAP_URL } from '../lib/buildings';
import { External, X } from './icons';

interface Props {
  /** Raw building name from TSS (possibly truncated). */
  building: string;
  room?: string;
  onClose: () => void;
}

/**
 * "Where is this class?" — shows the repaired building name plus map links.
 * Maps open only on the user's click (deep links), keeping the page request-free.
 */
export function BuildingPopover({ building, room, onClose }: Props) {
  const canonical = canonicalBuilding(building);
  const name = canonical ?? building;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop"
        role="dialog"
        aria-modal="true"
        aria-label={`${name} location`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mappop__close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
        <div className="eyebrow">Building</div>
        <div className="mappop__name">{name}</div>
        {room && <div className="mappop__room mono">Room {room}</div>}
        {canonical && canonical !== building && (
          <div className="mappop__raw">Listed in TSS as “{building}”</div>
        )}
        <div className="mappop__actions">
          <a
            className="btn btn--sm btn--primary"
            href={googleMapsLink(name)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <External size={14} /> Google Maps
          </a>
          <a
            className="btn btn--sm"
            href={UCSD_CAMPUS_MAP_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <External size={14} /> UCSD campus map
          </a>
        </div>
        <p className="mappop__hint">The UCSD map opens at campus view — search “{name}” there.</p>
      </div>
    </div>
  );
}
