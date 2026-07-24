import { useRef, useState } from 'react';
import { useClickAway } from '../hooks/useClickAway';
import { Check, ChevronDown, Copy, Pencil, Plus, Trash } from './icons';

export interface PlanRow {
  id: string;
  name: string;
  /** Courses in that plan — shown as a small count next to the name. */
  count: number;
}

interface Props {
  plans: PlanRow[];
  activeId: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * The named-plans dropdown in the topbar: switch between plans, start a new
 * one, rename/duplicate/delete. Everything is local data management — no
 * requests, no TSS interaction.
 */
export function PlanSwitcher({
  plans,
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickAway(open, wrapRef, () => setOpen(false));

  const activeName = plans.find((p) => p.id === activeId)?.name ?? 'Plan';
  const lastOne = plans.length <= 1;

  const rename = (id: string, current: string) => {
    const name = window.prompt('Rename plan', current);
    if (name !== null) onRename(id, name);
  };

  const remove = (id: string, name: string) => {
    if (window.confirm(`Delete “${name}”? Courses stay in your browsed list.`)) {
      onDelete(id);
    }
  };

  return (
    <div className="planswitch" ref={wrapRef}>
      <button
        type="button"
        className="planswitch__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch, create, or manage plans"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="planswitch__name">{activeName}</span>
        <ChevronDown size={13} strokeWidth={2.2} className="planswitch__chev" />
      </button>

      {open && (
        <div className="menu menu--left planmenu" role="menu">
          {plans.map((p) => {
            const isActive = p.id === activeId;
            return (
              <div key={p.id} className={`planmenu__row${isActive ? ' planmenu__row--active' : ''}`}>
                <button
                  type="button"
                  className="planmenu__main"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => {
                    onSwitch(p.id);
                    setOpen(false);
                  }}
                >
                  <span className="planmenu__check" aria-hidden>
                    {isActive && <Check size={13} strokeWidth={2.6} />}
                  </span>
                  <span className="planmenu__name">{p.name}</span>
                  <span className="planmenu__count mono">{p.count}</span>
                </button>
                <span className="planmenu__acts">
                  <button
                    type="button"
                    className="planmenu__act"
                    onClick={() => rename(p.id, p.name)}
                    aria-label={`Rename ${p.name}`}
                    title="Rename"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="planmenu__act"
                    onClick={() => {
                      onDuplicate(p.id);
                      setOpen(false);
                    }}
                    aria-label={`Duplicate ${p.name}`}
                    title="Duplicate — try another arrangement"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    className="planmenu__act planmenu__act--danger"
                    onClick={() => remove(p.id, p.name)}
                    disabled={lastOne}
                    aria-label={`Delete ${p.name}`}
                    title={lastOne ? 'Keep at least one plan' : 'Delete'}
                  >
                    <Trash size={13} />
                  </button>
                </span>
              </div>
            );
          })}
          <button
            type="button"
            className="planmenu__new"
            role="menuitem"
            onClick={() => {
              onCreate();
              setOpen(false);
            }}
          >
            <Plus size={13} strokeWidth={2.4} /> New plan
          </button>
        </div>
      )}
    </div>
  );
}
