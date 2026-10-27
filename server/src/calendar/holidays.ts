// UCSD campus holidays in the 2026-27 academic year, as ISO dates (America/Los_Angeles calendar days).
// Source: UCSD "Academic and Administrative Calendar 2026-2027" (Registrar, via Blink):
//   https://blink.ucsd.edu/instructors/resources/academic/calendars/2026.html
// Checked 2026-10-26 (page last updated 2026-03-31). Every date below is listed there as a holiday, and no
// classes meet on them. 2027-03-26 appears there as "Farmworkers Day Holiday" (the page does not say
// "César Chávez"); it is the same observance. The page also lists winter break (Dec 24-25, Dec 31 - Jan 1)
// and summer holidays, which fall outside any term, so they are left out: nothing would ever exclude them.
// Add the next year's dates here when the 2027-28 calendar is published.
export const UCSD_HOLIDAYS: readonly string[] = [
  '2026-11-11', // Veterans Day
  '2026-11-26', // Thanksgiving
  '2026-11-27',
  '2027-01-18', // Martin Luther King Jr. Day
  '2027-02-15', // Presidents' Day
  '2027-03-26', // Farmworkers Day (César Chávez Day)
  '2027-05-31', // Memorial Day
];
