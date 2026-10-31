import { googleMapsLink, matchBuilding } from '../lib/buildings';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { External, MapPinIcon, X } from './icons';

interface Props {
  /** Raw building name from TSS (possibly truncated). */
  building: string;
  room?: string;
  /**
   * Show the building on TritonPlan's own campus map. Absent inside that map
   * (it is already there), and offered only for a building the map can place.
   */
  onOpenCampusMap?: () => void;
  onClose: () => void;
}

/**
 * "Where is this class?" — shows the repaired building name plus map links:
 * TritonPlan's campus map first, Google Maps second. Google opens only on the
 * user's click (a deep link), keeping the page request-free.
 */
export function BuildingPopover({ building, room, onOpenCampusMap, onClose }: Props) {
  const hit = matchBuilding(building);
  const name = hit?.name ?? building;

  useEscapeKey(onClose);

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
        {hit && hit.name !== building && (
          <div className="mappop__raw">Listed in TSS as “{building}”</div>
        )}
        <div className="mappop__actions">
          {onOpenCampusMap && hit && (
            <button type="button" className="btn btn--sm btn--primary" onClick={onOpenCampusMap}>
              <MapPinIcon size={14} /> TritonPlan map
            </button>
          )}
          <a
            className={`btn btn--sm${onOpenCampusMap && hit ? '' : ' btn--primary'}`}
            href={googleMapsLink(hit ?? building)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <External size={14} /> Google Maps
          </a>
        </div>
      </div>
    </div>
  );
}
