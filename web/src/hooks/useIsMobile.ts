import { useEffect, useState } from 'react';

const QUERY = '(max-width: 760px)';

/** True below the mobile breakpoint. Safe under jsdom (no matchMedia → false). */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}
