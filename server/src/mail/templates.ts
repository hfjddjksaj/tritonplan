const IGNORE = "If you didn't ask for this, you can ignore this email.";

export function verifyEmailMail(link: string): { subject: string; text: string } {
  return {
    subject: 'Confirm your TritonPlan email',
    text: `Confirm your email address to finish setting up your TritonPlan account:\n\n${link}\n\n${IGNORE}\n`,
  };
}

/** Sent when someone submits sign-up for a Google-only account: only the mailbox owner can choose the password. */
export function addPasswordMail(link: string): { subject: string; text: string } {
  return {
    subject: 'Set a password for TritonPlan',
    text: `Your TritonPlan account signs in with Google. To also sign in with a password, choose one here:\n\n${link}\n\n${IGNORE}\n`,
  };
}

/** Sent on repeat sign-up for an unverified address: the mailbox owner, not the form submitter, chooses the password. */
export function finishSignupMail(link: string): { subject: string; text: string } {
  return {
    subject: 'Choose your TritonPlan password',
    text: `To finish signing up for TritonPlan, choose your password here:\n\n${link}\n\n${IGNORE}\n`,
  };
}

export function resetPasswordMail(link: string): { subject: string; text: string } {
  return {
    subject: 'Reset your TritonPlan password',
    text: `Use this link to choose a new TritonPlan password:\n\n${link}\n\n${IGNORE}\n`,
  };
}
