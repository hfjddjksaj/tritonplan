import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dialog } from './Dialog';
import { MenuSelect, type MenuOption } from './MenuSelect';
import { menuOptions, menuPick, menuSelects, menuShown, menuValue } from '../test/menu-select';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS: MenuOption[] = [
  { value: '', label: 'Not in calendar', faint: true },
  { value: 'a', label: 'Plan A', divider: true },
  { value: 'x', label: 'Gone plan', disabled: true },
  { value: 'b', label: 'Plan B' },
];

let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
const onClose = vi.fn();

function Harness({ inDialog = false }: { inDialog?: boolean }) {
  const [value, setValue] = useState('a');
  const select = (
    <MenuSelect
      label="Plan"
      value={value}
      options={OPTIONS}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
    />
  );
  return inDialog ? <Dialog label="Test" onClose={onClose}>{select}</Dialog> : select;
}

beforeEach(() => {
  onChange.mockClear();
  onClose.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const list = () => document.body.querySelector('[role="listbox"]');
const key = (el: Element, k: string) =>
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

describe('MenuSelect', () => {
  it('shows the choice on its button and lists every option, the chosen one marked', () => {
    act(() => root.render(<Harness />));
    const b = menuSelects()[0]!;
    expect(menuShown(b)).toBe('Plan A');
    expect(menuOptions(b)).toEqual([
      { value: '', label: 'Not in calendar', disabled: false, selected: false },
      { value: 'a', label: 'Plan A', disabled: false, selected: true },
      { value: 'x', label: 'Gone plan', disabled: true, selected: false },
      { value: 'b', label: 'Plan B', disabled: false, selected: false },
    ]);
    expect(list()).toBeNull();
  });

  it('a click on a row picks it and closes the list; the same row again changes nothing', () => {
    act(() => root.render(<Harness />));
    const b = menuSelects()[0]!;
    menuPick(b, 'b');
    expect(onChange).toHaveBeenCalledWith('b');
    expect(menuValue(b)).toBe('b');
    expect(list()).toBeNull();
    menuPick(b, 'b');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a disabled row cannot be picked', () => {
    act(() => root.render(<Harness />));
    const b = menuSelects()[0]!;
    act(() => b.click());
    const gone = document.body.querySelector<HTMLButtonElement>('[role="option"][data-value="x"]')!;
    act(() => gone.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens on the chosen row; arrows skip disabled rows; Enter picks', () => {
    act(() => root.render(<Harness />));
    const b = menuSelects()[0]!;
    b.focus();
    key(b, 'ArrowDown');
    expect((document.activeElement as HTMLElement).dataset.value).toBe('a');
    key(document.activeElement!, 'ArrowDown');
    expect((document.activeElement as HTMLElement).dataset.value).toBe('b');
    act(() => (document.activeElement as HTMLButtonElement).click()); // what Enter does on a button
    expect(onChange).toHaveBeenCalledWith('b');
    expect(document.activeElement).toBe(b);
  });

  it('Escape closes the list and hands focus back, without closing the dialog it sits in', () => {
    act(() => root.render(<Harness inDialog />));
    const b = menuSelects()[0]!;
    act(() => b.click());
    expect(list()).not.toBeNull();
    key(document.activeElement!, 'Escape');
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(b);
    expect(onClose).not.toHaveBeenCalled();
    // With the list shut, Escape is the dialog's again.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('a press outside closes the list', () => {
    act(() => root.render(<Harness />));
    act(() => menuSelects()[0]!.click());
    expect(list()).not.toBeNull();
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(list()).toBeNull();
  });
});
