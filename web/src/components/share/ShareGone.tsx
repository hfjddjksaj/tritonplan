/**
 * A shared plan's link once the plan is gone: expired, or never made. Says so plainly, with a way
 * in that is a full page load — the extension only talks to planner pages that start outside /s/.
 * Never a sign-in wall.
 */
import { AuthCard } from '../auth/AuthCard';

export function ShareGone() {
  return (
    <AuthCard heading="This shared plan has expired.">
      <p className="auth__lede">Shared plans last 7 days.</p>
      <a className="btn btn--primary auth__wide" href="/">
        Go to TritonPlan
      </a>
    </AuthCard>
  );
}
