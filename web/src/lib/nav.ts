/**
 * Full-page navigation behind one seam. jsdom can't navigate, and its Location
 * can't be stubbed, so tests spy on this object instead of on `location`.
 */
export const nav = {
  assign(url: string): void {
    window.location.assign(url);
  },
  reload(): void {
    window.location.reload();
  },
};

/**
 * A page the browser restores from its back/forward cache is the old document,
 * frozen: Back after signing out or deleting the account would show that planner
 * again without asking the server. Reload it so the sign-in gate runs.
 */
export function installBfcacheReload(reload: () => void = () => nav.reload()): () => void {
  const onPageShow = (ev: PageTransitionEvent) => {
    if (ev.persisted) reload();
  };
  window.addEventListener('pageshow', onPageShow);
  return () => window.removeEventListener('pageshow', onPageShow);
}
