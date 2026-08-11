import { describe, it, expect } from 'vitest';
import { splitLocationText, splitModalityLocation, examDisplay } from './exam-location.js';

describe('splitLocationText', () => {
  it('splits building and room on the last " Room "', () => {
    expect(splitLocationText('York Hall Room 2622')).toEqual({ building: 'York Hall', room: '2622' });
  });
  it('keeps a roomless string as the building', () => {
    expect(splitLocationText('RIMAC Arena')).toEqual({ building: 'RIMAC Arena' });
  });
});

describe('splitModalityLocation', () => {
  it('splits the polluted tail TSS now emits (real line, 2026-08-11)', () => {
    expect(splitModalityLocation('In Person @ York Hall Room 2622')).toEqual({
      modality: 'In Person',
      location: 'York Hall Room 2622',
      building: 'York Hall',
      room: '2622',
    });
  });
  it('leaves a clean modality alone', () => {
    expect(splitModalityLocation('In Person')).toEqual({ modality: 'In Person' });
    expect(splitModalityLocation('Live Online')).toEqual({ modality: 'Live Online' });
  });
  it('handles empty/undefined', () => {
    expect(splitModalityLocation(undefined)).toEqual({});
    expect(splitModalityLocation('  ')).toEqual({});
  });
});

describe('examDisplay', () => {
  it('prefers structured fields (new-parser captures)', () => {
    expect(
      examDisplay({ modality: 'In Person', location: 'York Hall Room 2622' }),
    ).toEqual({ modality: 'In Person', location: 'York Hall Room 2622', building: 'York Hall', room: '2622' });
  });
  it('falls back to splitting the modality tail (old captures, share-decoded)', () => {
    expect(examDisplay({ modality: 'In Person @ York Hall Room 2622' })).toEqual({
      modality: 'In Person', location: 'York Hall Room 2622', building: 'York Hall', room: '2622',
    });
  });
  it('exam with neither yields just the modality', () => {
    expect(examDisplay({ modality: 'In Person' })).toEqual({ modality: 'In Person' });
  });
});
