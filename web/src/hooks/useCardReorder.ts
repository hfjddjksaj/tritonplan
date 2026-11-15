import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { attachCardReorder } from '../lib/card-reorder';

/**
 * Ref callback for the list of cards. The list only exists while the plan has
 * courses, so it is held in state; the setter keeps the callback's identity
 * stable, and the effect depends on nothing else, so a reorder never detaches
 * the engine (which would cancel a landing in progress).
 */
export function useCardReorder(
  enabled: boolean,
  onReorder: (courseId: string, toIndex: number) => void,
): (el: HTMLElement | null) => void {
  const [list, setList] = useState<HTMLElement | null>(null);
  const latest = useRef(onReorder);
  latest.current = onReorder;

  useEffect(() => {
    if (!list || !enabled) return;
    const scroller = list.closest<HTMLElement>('.rail__scroll');
    const bounds = list.closest<HTMLElement>('.rail');
    if (!scroller || !bounds) return;
    return attachCardReorder(list, {
      scroller,
      bounds,
      // The engine measures the list straight after this returns, so the new
      // order has to be in the DOM by then.
      onReorder: (id, to) => flushSync(() => latest.current(id, to)),
    });
  }, [list, enabled]);

  return setList;
}
