import { expect, test } from 'vitest';
import { addPasswordMail, finishSignupMail, googleSignupMail, resetPasswordMail, verifyEmailMail } from './templates';

test('mail templates carry subject, link and the ignore line', () => {
  const v = verifyEmailMail('https://tritonplan.cn/#/verify?token=abc');
  expect(v.subject).toBe('Confirm your TritonPlan email');
  // The confirm page asks for the sign-up password (R18), so the mail says so up front.
  expect(v.text).toBe(
    'Confirm your TritonPlan email: open this link and enter the password you chose when you signed up.\n\n' +
      "https://tritonplan.cn/#/verify?token=abc\n\nIf you didn't ask for this, you can ignore this email.\n",
  );
  expect(v.text).toContain("If you didn't ask for this, you can ignore this email.");
  const r = resetPasswordMail('https://x/y');
  expect(r.subject).toBe('Reset your TritonPlan password');
  expect(r.text).toContain('https://x/y');
  expect(r.text).toContain("If you didn't ask for this, you can ignore this email.");
});

test("addPasswordMail carries subject, link and the ignore line", () => {
  const m = addPasswordMail("https://x/reset#token=t");
  expect(m.subject).toBe("Set a password for TritonPlan");
  expect(m.text).toContain("Your TritonPlan account signs in with Google. To also sign in with a password, choose one here:");
  expect(m.text).toContain("https://x/reset#token=t");
  expect(m.text).toContain("If you didn't ask for this, you can ignore this email.");
});

test("finishSignupMail asks for the password just chosen", () => {
  const m = finishSignupMail("https://x/verify#token=t");
  expect(m.subject).toBe("Finish signing up for TritonPlan");
  expect(m.text).toContain("To finish signing up for TritonPlan, open this link and enter the password you just chose:");
  expect(m.text).toContain("https://x/verify#token=t");
  expect(m.text).toContain("If you didn't ask for this, you can ignore this email.");
});

test("googleSignupMail says the address already signs in with Google", () => {
  const m = googleSignupMail("https://x/verify#token=t");
  expect(m.subject).toBe("Confirm your TritonPlan password");
  expect(m.text).toContain(
    "This email already signs in to TritonPlan with Google. To sign in with the password you just chose as well, open this link and enter it:",
  );
  expect(m.text).toContain("https://x/verify#token=t");
  expect(m.text).toContain("If you didn't ask for this, you can ignore this email.");
});
