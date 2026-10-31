/**
 * /verify#token=… — the sign-up confirmation link. The server also wants the
 * account's password: owning the mailbox alone must not confirm a sign-up
 * someone else typed in.
 */
import { AuthCard } from './AuthCard';
import { VERIFY_MISMATCH } from './copy';
import { TokenPasswordForm } from './TokenPasswordForm';

export function VerifyScreen({ token }: { token: string }) {
  return (
    <AuthCard heading="Confirm your email">
      <p className="auth__lede">Enter the password you chose when you signed up.</p>
      <TokenPasswordForm
        endpoint="/api/auth/verify"
        token={token}
        submitLabel="Confirm and sign in"
        autoComplete="current-password"
        byStatus={{ 401: VERIFY_MISMATCH }}
      />
    </AuthCard>
  );
}
