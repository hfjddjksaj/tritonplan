/** A short link that was turned off, or never existed: say so plainly, with a way in. Never a sign-in wall. */
import { AuthCard } from '../auth/AuthCard';

export function ShareGone() {
  return (
    <AuthCard heading="This link no longer works. The person who shared it may have turned it off.">
      <a className="btn btn--primary auth__wide share-gone__home" href="/">
        Go to TritonPlan
      </a>
    </AuthCard>
  );
}
