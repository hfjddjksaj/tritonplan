/**
 * Which of a shared plan's courses to keep, and where: a new plan of the visitor's own, or in
 * place of one of theirs in the same term. Replacing drops that plan's other courses, so it asks first.
 */
import { useState } from 'react';
import type { SharedDoc } from '../../lib/cloud/api';
import type { SharedSave } from '../../lib/shared-save';
import { displayTermLabel } from '../../lib/terms';
import { Dialog } from '../Dialog';
import { Field, Message } from '../Field';

interface Props {
  doc: SharedDoc;
  /** The visitor's plans in the shared plan's term; null when they could not be loaded. */
  myPlans: { id: string; name: string }[] | null;
  /** A term that is over: its plans are read-only, so none can be replaced. */
  termArchived: boolean;
  saving: boolean;
  error?: string | null;
  onConfirm: (save: SharedSave) => void;
  onClose: () => void;
}

export function SaveSharedDialog({ doc, myPlans, termArchived, saving, error, onConfirm, onClose }: Props) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(doc.plan.entries.map((e) => e.course.id)));
  const [mode, setMode] = useState<'new' | 'replace'>('new');
  const [name, setName] = useState(doc.name);
  const [target, setTarget] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const replaceable = !termArchived && myPlans !== null && myPlans.length > 0 ? myPlans : null;
  const replacing = mode === 'replace' && replaceable !== null;
  const targetPlan = replacing ? replaceable.find((p) => p.id === target) : undefined;
  // Courses cannot be added to or dropped from a shared plan, so ids picked from an earlier copy still match.
  const entries = doc.plan.entries.filter((e) => picked.has(e.course.id));
  const ready = entries.length > 0 && (!replacing || targetPlan !== undefined);

  const toggle = (id: string) => {
    setAsking(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  const choose = (m: 'new' | 'replace') => {
    setAsking(false);
    setMode(m);
  };
  const confirm = () => {
    if (!ready || saving) return;
    const plan = { ...doc.plan, entries };
    if (targetPlan) onConfirm({ plan, mode: { kind: 'replace', planId: targetPlan.id } });
    else onConfirm({ plan, mode: { kind: 'new', name: name.trim() || doc.name } });
  };

  return (
    <Dialog
      label="Save to my plans"
      className="savedlg"
      onClose={saving ? () => {} : onClose}
      eyebrow="Save to my plans"
      title={doc.name}
      meta="Pick the courses to keep. Switching sections here later won't change your copy."
      busy={saving}
    >
      <ul className="savedlg__courses">
        {doc.plan.entries.map((e) => {
          const section = e.course.options.find((o) => o.id === e.selectedOptionId)?.code;
          return (
            <li key={e.course.id}>
              <label className="savedlg__course">
                <input
                  type="checkbox"
                  checked={picked.has(e.course.id)}
                  disabled={saving}
                  onChange={() => toggle(e.course.id)}
                />
                <span className="savedlg__code mono">{e.course.courseCode}</span>
                <span className="savedlg__title">{e.course.title}</span>
                {section && <span className="savedlg__sec mono">{section}</span>}
              </label>
            </li>
          );
        })}
      </ul>

      <div className="savedlg__modes">
        <label className="savedlg__mode">
          <input type="radio" name="savedlg-mode" checked={!replacing} disabled={saving} onChange={() => choose('new')} />
          Save as a new plan
        </label>
        {!replacing && (
          <div className="savedlg__sub">
            <Field
              label="Name"
              type="text"
              value={name}
              maxLength={80}
              disabled={saving}
              onChange={(ev) => setName(ev.target.value)}
            />
          </div>
        )}
        {replaceable && (
          <label className="savedlg__mode">
            <input type="radio" name="savedlg-mode" checked={replacing} disabled={saving} onChange={() => choose('replace')} />
            Replace a plan
          </label>
        )}
        {replacing && (
          <div className="savedlg__sub savedlg__targets" role="radiogroup" aria-label="Plan to replace">
            {replaceable.map((p) => (
              <label key={p.id} className="savedlg__target">
                <input
                  type="radio"
                  name="savedlg-target"
                  checked={target === p.id}
                  disabled={saving}
                  onChange={() => {
                    setAsking(false);
                    setTarget(p.id);
                  }}
                />
                {p.name}
              </label>
            ))}
          </div>
        )}
      </div>

      {termArchived && (
        <p className="mappop__hint">{displayTermLabel(doc.plan.term)} is over, so the plan you save will be read-only.</p>
      )}
      {error && <Message tone="error">{error}</Message>}

      {asking && targetPlan ? (
        <div className="savedlg__ask">
          <p className="savedlg__question">
            Replace "{targetPlan.name}"? Its courses will be swapped for the ones you picked.
          </p>
          <div className="mappop__actions">
            <button type="button" className="btn btn--primary" disabled={saving} onClick={confirm}>
              Replace
            </button>
            <button type="button" className="btn" disabled={saving} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--primary savedlg__save"
          disabled={!ready || saving}
          onClick={() => (replacing ? setAsking(true) : confirm())}
        >
          Save
        </button>
      )}
    </Dialog>
  );
}
