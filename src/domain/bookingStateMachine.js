import { DomainError } from './errors.js';

export const BOOKING_STATES = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  CHECKED_IN: 'checked_in',
});

export const ALLOWED_TRANSITIONS = Object.freeze({
  [BOOKING_STATES.PENDING]: Object.freeze([
    BOOKING_STATES.PAID,
    BOOKING_STATES.CANCELLED,
  ]),
  [BOOKING_STATES.PAID]: Object.freeze([
    BOOKING_STATES.CHECKED_IN,
    BOOKING_STATES.REFUNDED,
    BOOKING_STATES.CANCELLED,
  ]),
  [BOOKING_STATES.CANCELLED]: Object.freeze([]),
  [BOOKING_STATES.REFUNDED]: Object.freeze([]),
  [BOOKING_STATES.CHECKED_IN]: Object.freeze([]),
});

export function canTransition(from, to) {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new DomainError(`Booking cannot transition from ${String(from)} to ${String(to)}.`, 'INVALID_TRANSITION');
  }

  return true;
}