const IGNORE = "If you didn't ask for this, you can ignore this email.";

export function verifyEmailMail(link: string): { subject: string; text: string } {
  return {
    subject: 'Confirm your TritonPlan email',
    // The confirm page asks for the sign-up password (it proves the mailbox owner also chose it), so say so here.
    text: `Confirm your TritonPlan email: open this link and enter the password you chose when you signed up.\n\n${link}\n\n${IGNORE}\n`,
  };
}

/** Sent when someone submits sign-up for a Google-only account: only the mailbox owner can choose the password. */
export function addPasswordMail(link: string): { subject: string; text: string } {
  return {
    subject: 'Set a password for TritonPlan',
    text: `Your TritonPlan account signs in with Google. To also sign in with a password, choose one here:\n\n${link}\n\n${IGNORE}\n`,
  };
}

/**
 * Sent on repeat sign-up for an unverified address. The link confirms the password submitted with it, so only
 * someone holding both the mailbox and that password can finish: a stranger's sign-up dead-ends with the owner.
 */
export function finishSignupMail(link: string): { subject: string; text: string } {
  return {
    subject: 'Finish signing up for TritonPlan',
    text: `To finish signing up for TritonPlan, open this link and enter the password you just chose:\n\n${link}\n\n${IGNORE}\n`,
  };
}

/** Sent when someone signs up with an address that already signs in with Google; the link confirms the password, as above. */
export function googleSignupMail(link: string): { subject: string; text: string } {
  return {
    subject: 'Confirm your TritonPlan password',
    text:
      'This email already signs in to TritonPlan with Google. ' +
      `To sign in with the password you just chose as well, open this link and enter it:\n\n${link}\n\n${IGNORE}\n`,
  };
}

export function resetPasswordMail(link: string): { subject: string; text: string } {
  return {
    subject: 'Reset your TritonPlan password',
    text: `Use this link to choose a new TritonPlan password:\n\n${link}\n\n${IGNORE}\n`,
  };
}
