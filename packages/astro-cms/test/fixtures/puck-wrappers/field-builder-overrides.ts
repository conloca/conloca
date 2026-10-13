/**
 * Two builders that spread what the caller passes, on either side of what they
 * write themselves. Where the spread sits decides which value survives, so a
 * reader that merges in the wrong order reports a bound the field does not have.
 */
import { ctaButtonArrayField, type FieldLike } from './cta-button-array-field.js';

const bounds = { type: 'number', min: 0, max: 10 };

/** The override comes first, so the bounds written after it win. */
function boundedNumber(overrides?: { min?: number; max?: number }): FieldLike {
  return { ...overrides, ...bounds };
}

/** The copied site builder with the override it exists to take: `max: 4` spread over by `max: 2`. */
export const Overridden = ctaButtonArrayField({ max: 2 });

/** The same override against a builder that spreads it BEFORE its own bounds: `max` stays 10. */
export const Underridden = boundedNumber({ max: 2 });
