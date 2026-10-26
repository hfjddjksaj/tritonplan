import { expect, test } from 'vitest';
import { addPasswordMail, finishSignupMail, resetPasswordMail, verifyEmailMail } from './templates';

test('mail templates carry subject, link and the ignore line', () => {
  const v = verifyEmailMail('https://tritonplan.cn/#/verify?token=abc');
  expect(v.subject).toBe('Confirm your TritonPlan email');
  expect(v.text).toContain('https://tritonplan.cn/#/verify?token=abc');
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

test("finishSignupMail carries subject, body, link and the ignore line", () => {
  const m = finishSignupMail("https://x/reset#token=t");
  expect(m.subject).toBe("Choose your TritonPlan password");
  expect(m.text).toContain("To finish signing up for TritonPlan, choose your password here:");
  expect(m.text).toContain("https://x/reset#token=t");
  expect(m.text).toContain("If you didn't ask for this, you can ignore this email.");
});
