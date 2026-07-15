import { describe, expect, it } from 'vitest';

import { normalizeTitle, surname } from './normalize';

describe('normalizeTitle', () => {
  it('converts LaTeX accent commands to base letters', () => {
    expect(normalizeTitle('Jo\\~{a}o')).toContain('joao');
    expect(normalizeTitle("Gavald\\`{a}")).toContain('gavalda');
    expect(normalizeTitle('Sch{\\"o}lkopf')).toContain('scholkopf');
  });

  it('strips Unicode diacritics (parser Path A output)', () => {
    expect(normalizeTitle('João')).toBe('joao');
    expect(normalizeTitle('Schölkopf')).toBe('scholkopf');
    expect(normalizeTitle('Gavaldà')).toBe('gavalda');
  });

  it('strips protective braces', () => {
    expect(normalizeTitle('How to train your {MAML}')).toBe('how to train your maml');
    expect(normalizeTitle('i{C}a{RL}: Incremental Classifier')).toContain('icarl');
  });

  it('lowercases and collapses whitespace/punctuation', () => {
    expect(normalizeTitle('  Deep   Learning!!  ')).toBe('deep learning');
  });

  it('handles empty input', () => {
    expect(normalizeTitle('')).toBe('');
  });
});

describe('surname', () => {
  it('extracts surname from "Last, First"', () => {
    expect(surname('Finn, Chelsea')).toBe('finn');
  });

  it('extracts surname from "First Last"', () => {
    expect(surname('Chelsea Finn')).toBe('finn');
  });

  it('is accent-safe', () => {
    expect(surname('Bernhard Schölkopf')).toBe('scholkopf');
    expect(surname('Sch{\\"o}lkopf, Bernhard')).toBe('scholkopf');
  });

  it('keeps multi-word surnames with particles in comma form', () => {
    expect(surname("del Campo-\\'{A}vila, Jos\\'{e}")).toBe('del campo-avila');
    expect(surname('del Campo-Ávila, José')).toBe('del campo-avila');
  });

  it('handles empty input', () => {
    expect(surname('')).toBe('');
  });
});
