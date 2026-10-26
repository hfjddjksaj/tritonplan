/**
 * Full-page navigation behind one seam. jsdom can't navigate, and its Location
 * can't be stubbed, so tests spy on this object instead of on `location`.
 */
export const nav = {
  assign(url: string): void {
    window.location.assign(url);
  },
};
