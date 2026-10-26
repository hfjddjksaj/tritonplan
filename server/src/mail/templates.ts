const IGNORE = "If you didn't ask for this, you can ignore this email.";

export function verifyEmailMail(link: string): { subject: string; text: string } {
  return {
    subject: 'Confirm your TritonPlan email',
    text: `Confirm your email address to finish setting up your TritonPlan account:\n\n${link}\n\n${IGNORE}\n`,
  };
}

export function resetPasswordMail(link: string): { subject: string; text: string } {
  return {
    subject: 'Reset your TritonPlan password',
    text: `Use this link to choose a new TritonPlan password:\n\n${link}\n\n${IGNORE}\n`,
  };
}
