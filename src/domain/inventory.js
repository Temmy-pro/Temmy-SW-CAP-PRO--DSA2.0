import { DomainError } from './errors.js';
import { newId, newReference } from './ids.js';
import { Queue } from './waitlistQueue.js';

function assertStore(store) {
  if (
    store === null
    || typeof store !== 'object'
    || !(store.events instanceof Map)
    || !(store.tiers instanceof Map)
    || !(store.bookings instanceof Map)
    || !(store.bookingsByReference instanceof Map)
    || !(store.waitlists instanceof Map)
  ) {
    throw new DomainError('A valid inventory store is required.', 'VALIDATION');
  }
}

function assertRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError(`${label} must be an object.`, 'VALIDATION');
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainError(`${label} must be a non-empty string.`, 'VALIDATION');
  }

  return value.trim();
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DomainError(`${label} must be a positive safe integer.`, 'VALIDATION');
  }
}

function getEvent(store, eventId) {
  const event = store.events.get(eventId);

  if (event === undefined) {
    throw new DomainError('Event was not found.', 'NOT_FOUND');
  }

  return event;
}

function getTier(store, tierId) {
  const tier = store.tiers.get(tierId);

  if (tier === undefined) {
    throw new DomainError('Ticket tier was not found.', 'NOT_FOUND');
  }

  return tier;
}

export function createStore() {
  return {
    events: new Map(),
    tiers: new Map(),
    bookings: new Map(),
    bookingsByReference: new Map(),
    waitlists: new Map(),
  };
}

export function createEvent(store, eventInput) {
  assertStore(store);
  assertRecord(eventInput, 'Event');

  const title = requireText(eventInput.title, 'Event title');
  const city = requireText(eventInput.city, 'Event city');
  const venue = requireText(eventInput.venue, 'Event venue');
  const date = requireText(eventInput.date, 'Event date');

  if (!Number.isFinite(Date.parse(date))) {
    throw new DomainError('Event date must be a valid date.', 'VALIDATION');
  }

  const event = { id: newId(), title, city, venue, date };
  store.events.set(event.id, event);
  return event;
}

export function addTier(store, eventId, tierInput) {
  assertStore(store);
  requireText(eventId, 'Event id');
  const event = getEvent(store, eventId);
  assertRecord(tierInput, 'Ticket tier');

  const name = requireText(tierInput.name, 'Ticket tier name');

  if (!Number.isSafeInteger(tierInput.priceCents) || tierInput.priceCents < 0) {
    throw new DomainError('Ticket price must be a non-negative whole number of cents.', 'VALIDATION');
  }

  requirePositiveInteger(tierInput.capacity, 'Ticket capacity');

  const tier = {
    id: newId(),
    eventId: event.id,
    name,
    priceCents: tierInput.priceCents,
    capacity: tierInput.capacity,
    available: tierInput.capacity,
  };

  store.tiers.set(tier.id, tier);
  return tier;
}

export function bookTickets(store, bookingInput) {
  assertStore(store);
  assertRecord(bookingInput, 'Booking');

  const eventId = requireText(bookingInput.eventId, 'Event id');
  const tierId = requireText(bookingInput.tierId, 'Ticket tier id');
  const attendeeName = requireText(bookingInput.attendeeName, 'Attendee name');
  const quantity = bookingInput.quantity;

  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
    throw new DomainError('A booking must contain between 1 and 10 tickets.', 'VALIDATION');
  }

  const event = getEvent(store, eventId);
  const tier = getTier(store, tierId);

  if (tier.eventId !== event.id) {
    throw new DomainError('Ticket tier does not belong to this event.', 'VALIDATION');
  }

  if (tier.available < quantity) {
    throw new DomainError('Not enough tickets are available.', 'SOLD_OUT');
  }

  const totalCents = tier.priceCents * quantity;

  if (!Number.isSafeInteger(totalCents)) {
    throw new DomainError('Booking total exceeds the safe integer range.', 'VALIDATION');
  }

  let reference = newReference();
  while (store.bookingsByReference.has(reference)) {
    reference = newReference();
  }

  const booking = {
    id: newId(),
    reference,
    eventId: event.id,
    tierId: tier.id,
    attendeeName,
    quantity,
    totalCents,
    status: 'ACTIVE',
  };

  tier.available -= quantity;
  store.bookings.set(booking.id, booking);
  store.bookingsByReference.set(booking.reference, booking);
  return booking;
}

export function cancelBooking(store, referenceInput) {
  assertStore(store);
  const reference = requireText(referenceInput, 'Booking reference');
  const booking = store.bookingsByReference.get(reference);

  if (booking === undefined) {
    throw new DomainError('Booking was not found.', 'NOT_FOUND');
  }

  if (booking.status !== 'ACTIVE') {
    throw new DomainError('Booking has already been cancelled.', 'INVALID_STATE');
  }

  const tier = getTier(store, booking.tierId);

  if (tier.available + booking.quantity > tier.capacity) {
    throw new DomainError('Cancelling would exceed ticket tier capacity.', 'INVALID_STATE');
  }

  tier.available += booking.quantity;
  booking.status = 'CANCELLED';
  return booking;
}

export function findBookingByReference(store, referenceInput) {
  assertStore(store);
  const reference = requireText(referenceInput, 'Booking reference');
  const booking = store.bookingsByReference.get(reference);

  if (booking === undefined) {
    throw new DomainError('Booking was not found.', 'NOT_FOUND');
  }

  return booking;
}

export function joinWaitlist(store, waitlistInput) {
  assertStore(store);
  assertRecord(waitlistInput, 'Waitlist entry');

  const tierId = requireText(waitlistInput.tierId, 'Ticket tier id');
  const attendeeName = requireText(waitlistInput.attendeeName, 'Attendee name');
  const tier = getTier(store, tierId);

  if (tier.available !== 0) {
    throw new DomainError('Waitlists are only available for sold-out ticket tiers.', 'NOT_SOLD_OUT');
  }

  let queue = store.waitlists.get(tier.id);
  if (queue === undefined) {
    queue = new Queue();
    store.waitlists.set(tier.id, queue);
  }

  const entry = { attendeeName, tierId: tier.id };
  queue.enqueue(entry);
  return entry;
}