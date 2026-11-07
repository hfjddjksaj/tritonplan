import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Term } from '@triton/shared';
import type { SharedDoc } from '../../lib/cloud/api';
import { makeClashPlan } from '../../lib/fixtures';
import { SaveSharedDialog } from './SaveSharedDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** CSE-8A on P-002 and MATH-18 on its first section. */
function docOf(): SharedDoc {
  const plan = makeClashPlan();
  plan.entries[0]!.selectedOptionId = 'o2';
  return { name: 'Fall draft', plan, version: 4, expiresAt: '2026-11-12T00:00:00.000Z' };
}
const MINE = [
  { id: 'plan-1', name: 'Mine' },
  { id: 'plan-2', name: 'Backup' },
];

let container: HTMLDivElement;
let root: Root;
const onConfirm = vi.fn();
const onClose = vi.fn();

type Props = Partial<Parameters<typeof SaveSharedDialog>[0]>;
let doc: SharedDoc;
function render(p: Props = {}) {
  act(() =>
    root.render(
      <SaveSharedDialog
        doc={doc}
        myPlans={MINE}
        termArchived={false}
        saving={false}
        onConfirm={onConfirm}
        onClose={onClose}
        {...p}
      />,
    ),
  );
}

beforeEach(() => {
  onConfirm.mockReset();
  onClose.mockReset();
  doc = docOf();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const dlg = () => document.body.querySelector<HTMLElement>('[role="dialog"]')!;
const text = () => dlg().textContent ?? '';
function button(label: string): HTMLButtonElement {
  const b = [...dlg().querySelectorAll('button')].find((el) => el.textContent?.trim() === label);
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  return b;
}
const hasButton = (label: string) => [...dlg().querySelectorAll('button')].some((el) => el.textContent?.trim() === label);
function labelled(label: string): HTMLInputElement {
  const l = [...dlg().querySelectorAll('label')].find((el) => el.textContent?.trim() === label);
  const input = l?.querySelector('input');
  if (!input) throw new Error(`no input labelled "${label}" in: ${text()}`);
  return input;
}
const courseBoxes = () => [...dlg().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const nameField = () => dlg().querySelector<HTMLInputElement>('input[type="text"]')!;
function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const click = (el: HTMLElement) => act(() => el.click());
const ids = (call: unknown[]) =>
  (call[0] as { plan: { entries: { course: { id: string } }[] } }).plan.entries.map((e) => e.course.id);

describe('SaveSharedDialog', () => {
  it('lists every course with its section, all picked, and saves as a new plan under the shared name', () => {
    render();
    expect(text()).toContain('CSE-8A');
    expect(text()).toContain('Course CSE-8A');
    expect(text()).toContain('P-002');
    expect(text()).toContain('MATH-18');
    expect(courseBoxes()).toHaveLength(2);
    expect(courseBoxes().every((b) => b.checked)).toBe(true);
    expect(labelled('Save as a new plan').checked).toBe(true);
    expect(nameField().value).toBe('Fall draft');

    click(button('Save'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const save = onConfirm.mock.calls[0]![0];
    expect(save.mode).toEqual({ kind: 'new', name: 'Fall draft' });
    expect(save.plan.term).toEqual(doc.plan.term);
    expect(ids(onConfirm.mock.calls[0]!)).toEqual(['CSE-8A|2026|2', 'MATH-18|2026|2']);
    // The sections and colours on show go along.
    expect(save.plan.entries[0]).toEqual(doc.plan.entries[0]);
  });

  it('saves only the courses left picked, under the name typed', () => {
    render();
    click(courseBoxes()[0]!);
    type(nameField(), '  With Ana  ');
    click(button('Save'));
    expect(ids(onConfirm.mock.calls[0]!)).toEqual(['MATH-18|2026|2']);
    expect(onConfirm.mock.calls[0]![0].mode).toEqual({ kind: 'new', name: 'With Ana' });
  });

  it('needs at least one course', () => {
    render();
    for (const b of courseBoxes()) click(b);
    expect(button('Save').disabled).toBe(true);
    click(button('Save'));
    expect(onConfirm).not.toHaveBeenCalled();
    click(courseBoxes()[1]!);
    expect(button('Save').disabled).toBe(false);
  });

  it('replace asks before it swaps the courses of the plan picked', () => {
    render();
    click(labelled('Replace a plan'));
    expect(nameField()).toBeNull();
    expect(button('Save').disabled).toBe(true); // which plan, first
    click(labelled('Backup'));
    click(button('Save'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(text()).toContain('Replace "Backup"? Its courses will be swapped for the ones you picked.');

    click(button('Cancel'));
    expect(text()).not.toContain('Replace "Backup"?');
    expect(onConfirm).not.toHaveBeenCalled();

    click(button('Save'));
    click(button('Replace'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0].mode).toEqual({ kind: 'replace', planId: 'plan-2' });
    expect(ids(onConfirm.mock.calls[0]!)).toEqual(['CSE-8A|2026|2', 'MATH-18|2026|2']);
  });

  it.each<[string, Props]>([
    ['their plans could not be loaded', { myPlans: null }],
    ['they have no plans in that term', { myPlans: [] }],
    ['the term is over', { termArchived: true }],
  ])('offers no replace when %s', (_, p) => {
    render(p);
    expect(text()).not.toContain('Replace a plan');
    expect(labelled('Save as a new plan').checked).toBe(true);
    expect(nameField().value).toBe('Fall draft');
  });

  it('says a plan from a term that is over is saved read-only', () => {
    const FA25: Term = { year: '2025', period: '2', label: 'Fall 2025' };
    doc = { ...doc, plan: { ...doc.plan, term: FA25 } };
    render({ termArchived: true });
    expect(text()).toContain('Fall 2025 is over, so the plan you save will be read-only.');
  });

  it('while saving nothing can be clicked twice; an error shows in the dialog', () => {
    render({ saving: true });
    expect(button('Save').disabled).toBe(true);
    render({ saving: false, error: "Couldn't save. Try again." });
    expect(dlg().querySelector('[role="alert"]')?.textContent).toBe("Couldn't save. Try again.");
    expect(button('Save').disabled).toBe(false);
  });

  it('× closes it, but not while a save is going out', () => {
    render();
    click(dlg().querySelector<HTMLButtonElement>('[aria-label="Close"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
    render({ saving: true });
    click(dlg().querySelector<HTMLButtonElement>('[aria-label="Close"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hasButton('Save')).toBe(true);
  });
});
