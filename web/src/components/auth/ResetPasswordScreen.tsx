/** /reset#token=… — the forgot-password (and "set a password") link. Works signed out. */
import { AuthCard } from './AuthCard';
import { TokenPasswordForm } from './TokenPasswordForm';

export function ResetPasswordScreen({ token }: { token: string }) {
  return (
    <AuthCard heading="Choose a new password">
      <TokenPasswordForm endpoint="/api/auth/reset" token={token} submitLabel="Save password" autoComplete="new-password" />
    </AuthCard>
  );
}
