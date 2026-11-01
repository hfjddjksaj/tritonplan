/**
 * Driving a MenuSelect from a test the way a student does: open the list from its
 * button, click a row. The list is portaled to <body>, so it is looked up there.
 */
import { act } from 'react';

/** The MenuSelect buttons under `root`, in document order. */
export const menuSelects = (root: ParentNode = document.body): HTMLButtonElement[] => [
  ...root.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]'),
];

/** The value the select holds. */
export const menuValue = (button: HTMLButtonElement): string => button.dataset.value ?? '';

/** The text the button shows for the current choice. */
export const menuShown = (button: HTMLButtonElement): string =>
  button.querySelector('.msel__text')?.textContent ?? '';

export interface MenuOptionView {
  value: string;
  label: string;
  disabled: boolean;
  selected: boolean;
}

const rows = (): HTMLButtonElement[] => [
  ...document.body.querySelectorAll<HTMLButtonElement>('[role="listbox"] [role="option"]'),
];

/** Every option as the open list shows it; the list is closed again afterwards. */
export function menuOptions(button: HTMLButtonElement): MenuOptionView[] {
  act(() => button.click());
  const out = rows().map((o) => ({
    value: o.dataset.value ?? '',
    label: o.querySelector('.menu__label')?.textContent ?? '',
    disabled: o.disabled,
    selected: o.getAttribute('aria-selected') === 'true',
  }));
  act(() => button.click());
  return out;
}

/** Open the list and click the option holding `value`. */
export function menuPick(button: HTMLButtonElement, value: string): void {
  act(() => button.click());
  const option = rows().find((o) => o.dataset.value === value);
  if (!option) throw new Error(`MenuSelect has no option "${value}"`);
  act(() => option.click());
}
