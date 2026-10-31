import { Eye } from './icons';

/**
 * Always-visible reminder on the signed-out planner, in the received-plan banner's
 * look: what is on screen is not saved anywhere, and keeping or editing it needs an account.
 */
export function GuestBanner({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="received received--active" role="status">
      <span className="received__label">
        <Eye size={14} /> You’re not signed in
      </span>
      <span className="received__text">Nothing here is saved. Sign in to keep your plan and edit it.</span>
      <span className="received__spacer" />
      <button type="button" className="btn btn--sm btn--primary" onClick={onSignIn}>
        Sign in
      </button>
    </div>
  );
}
