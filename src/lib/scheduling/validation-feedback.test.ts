import { describe, expect, it } from 'vitest';
import { validationFailureMessage } from './validation-feedback';

describe('validationFailureMessage', () => {
  it('surfaces critical results even when there are no unfilled positions', () => {
    const message = validationFailureMessage({
      results: [
        { severity: 'critical', message: 'Dhon Obniala is unavailable for week 1' },
        { severity: 'critical', message: 'Required Devotion role is not assigned' },
        { severity: 'warning', message: 'Heidi Herrera was scheduled 1 week(s) ago' },
      ],
      unfilled_positions: [],
    });
    expect(message).toBe('Cannot validate yet: Dhon Obniala is unavailable for week 1 \u00b7 Required Devotion role is not assigned.');
  });

  it('dedupes repeated critical messages', () => {
    const message = validationFailureMessage({
      results: [
        { severity: 'critical', message: 'Maricar Cariso is unavailable for week 4' },
        { severity: 'critical', message: 'Maricar Cariso is unavailable for week 4' },
      ],
    });
    expect(message).toBe("Cannot validate yet: Maricar Cariso is unavailable for week 4.");
  });

  it('ignores warnings and suggestions', () => {
    const message = validationFailureMessage({
      results: [
        { severity: 'warning', message: 'Kai Banawa was scheduled 1 week(s) ago' },
        { severity: 'suggestion', message: 'Sam has more assignments than average' },
      ],
    });
    expect(message).toBe('Could not validate this schedule.');
  });

  it('falls back to the gap list when no critical result is present', () => {
    const message = validationFailureMessage({
      unfilled_positions: [{ role_name: 'Devotion' }, { role_name: 'Drums' }],
    });
    expect(message).toBe('Cannot validate yet: 2 position(s) still unfilled (Devotion, Drums). Fill them in the lineup first.');
  });

  it('falls back to the route error, then to the generic message', () => {
    expect(validationFailureMessage({ error: 'The schedule changed. Refresh before validating.' })).toBe('The schedule changed. Refresh before validating.');
    expect(validationFailureMessage({})).toBe('Could not validate this schedule.');
  });
});
