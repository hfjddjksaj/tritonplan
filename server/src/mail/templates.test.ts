import { expect, test } from 'vitest';
import { resetPasswordMail, verifyEmailMail } from './templates';

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
