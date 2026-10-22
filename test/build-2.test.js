import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../src/domain/errors.js';
import {
  addTier,
  bookTickets,
  cancelBooking,
  createEvent,
  createStore,
  joinWaitlist,
  listEventSummaries,
  publishEvent,
} from '../src/domain/inventory.js';
import { filterEvents, searchEvents, sortEvents } from '../src/domain/eventSearch.js';
import { mergeSort } from '../src/domain/sorting.js';

function createPublishedEvent(store, data, tierInputs = []) {
  const event = createEvent(store, data);
  for (const tierInput of tierInputs) {
    addTier(store, event.id, tierInput);
  }
  publishEvent(store, event.id);
  return event;
}

function eventData(title, date = '2026-12-05', city = 'Lagos', venue = 'Central Hall') {
  return { title, date, city, venue };
}

function tierData(name, priceCents, capacity) {
  return { name, priceCents, capacity };
}

function expectDomainError(action, code) {
  assert.throws(action, (error) => error instanceof DomainError && error.code === code);
}

test('S02: valid event is saved as a draft with an id and is hidden publicly', () => {
  const store = createStore();
  const event = createEvent(store, eventData('Lagos Tech Meetup'));

  assert.match(event.id, /^[0-9a-f-]{36}$/i);
  assert.equal(event.status, 'DRAFT');
  assert.deepEqual(listEventSummaries(store), []);
  assert.equal(listEventSummaries(store, { publishedOnly: false })[0].id, event.id);
});

test('S02: missing required event fields and impossible dates fail without saving', () => {
  const invalidEvents = [
    { title: 'Missing city', venue: 'Hall', date: '2026-12-05' },
    { city: 'Lagos', venue: 'Hall', date: '2026-12-05' },
    { ...eventData('Bad date'), date: '2026-02-30' },
  ];

  for (const eventInput of invalidEvents) {
    const store = createStore();
    expectDomainError(() => createEvent(store, eventInput), 'VALIDATION');
    assert.equal(store.events.size, 0);
  }
});

test('S03: a tier has a whole-cent price, capacity, and all seats available', () => {
  const store = createStore();
  const event = createEvent(store, eventData('Tiered Event'));
  const tier = addTier(store, event.id, { name: 'General', priceCents: 500000, capacity: 100 });

  assert.equal(tier.priceCents, 500000);
  assert.equal(tier.capacity, 100);
  assert.equal(tier.sold, 0);
  assert.equal(tier.available, 100);
});

test('S03: fractional prices and capacities below one fail validation', () => {
  const store = createStore();
  const event = createEvent(store, eventData('Tier Validation'));

  expectDomainError(() => addTier(store, event.id, { name: 'Fractional', priceCents: 1.5, capacity: 1 }), 'VALIDATION');
  expectDomainError(() => addTier(store, event.id, { name: 'No Seats', priceCents: 100, capacity: 0 }), 'VALIDATION');
  assert.equal(store.tiers.size, 0);
});

test('S03: adding a tier to a missing event returns NOT_FOUND', () => {
  const store = createStore();

  expectDomainError(() => addTier(store, 'missing-event', { name: 'General', priceCents: 100, capacity: 1 }), 'NOT_FOUND');
});

test('S04: publishing with a tier makes the event public', () => {
  const store = createStore();
  const event = createEvent(store, eventData('Ready to Publish'));
  addTier(store, event.id, { name: 'General', priceCents: 100, capacity: 2 });

  assert.equal(publishEvent(store, event.id).status, 'PUBLISHED');
  assert.equal(listEventSummaries(store)[0].id, event.id);
});

test('S04: publishing without tiers returns INVALID_STATE and leaves a draft', () => {
  const store = createStore();
  const event = createEvent(store, eventData('No Tiers'));

  expectDomainError(() => publishEvent(store, event.id), 'INVALID_STATE');
  assert.equal(event.status, 'DRAFT');
  assert.deepEqual(listEventSummaries(store), []);
});

test('S04: public listing hides drafts and can include them explicitly', () => {
  const store = createStore();
  createEvent(store, eventData('Draft Event'));
  createPublishedEvent(store, eventData('Published Event'), [tierData('General', 100, 1)]);

  assert.deepEqual(listEventSummaries(store).map((event) => event.title), ['Published Event']);
  assert.deepEqual(listEventSummaries(store, { publishedOnly: false }).map((event) => event.title), ['Draft Event', 'Published Event']);
});

test('S05: text search matches title or venue without case sensitivity', () => {
  const store = createStore();
  createPublishedEvent(store, eventData('Lagos Tech Meetup'), [tierData('General', 100, 1)]);
  createPublishedEvent(store, eventData('Abuja Night', '2026-12-06', 'Abuja', 'Jazz Pavilion'), [tierData('General', 100, 1)]);
  const summaries = listEventSummaries(store);

  assert.deepEqual(filterEvents(summaries, { q: 'JAZZ' }).map((event) => event.title), ['Abuja Night']);
  assert.deepEqual(filterEvents(summaries, { q: 'TECH' }).map((event) => event.title), ['Lagos Tech Meetup']);
});

test('S05: city filter matches exactly without case sensitivity', () => {
  const store = createStore();
  createPublishedEvent(store, eventData('Lagos One', '2026-12-05', 'Lagos'), [tierData('General', 100, 1)]);
  createPublishedEvent(store, eventData('Abuja One', '2026-12-06', 'Abuja'), [tierData('General', 100, 1)]);

  assert.deepEqual(filterEvents(listEventSummaries(store), { city: 'lagos' }).map((event) => event.title), ['Lagos One']);
});

test('S05: maximum price uses the cheapest tier, sorts cheapest first, and excludes events without tiers', () => {
  const store = createStore();
  createPublishedEvent(store, eventData('More Expensive'), [tierData('Premium', 5000, 2), tierData('General', 2500, 2)]);
  createPublishedEvent(store, eventData('Cheapest', '2026-12-06'), [tierData('General', 1000, 2)]);
  const noTiers = createEvent(store, eventData('No Tiers', '2026-12-07'));
  noTiers.status = 'PUBLISHED';

  assert.deepEqual(searchEvents(listEventSummaries(store), { maxPriceCents: 3000 }, 'price').map((event) => event.title), ['Cheapest', 'More Expensive']);
});

test('S05: date sort is earliest first and breaks same-day ties by title', () => {
  const store = createStore();
  createPublishedEvent(store, eventData('Zulu', '2026-12-05T17:00:00Z'), [tierData('General', 100, 1)]);
  createPublishedEvent(store, eventData('Alpha', '2026-12-05T09:00:00Z'), [tierData('General', 100, 1)]);
  createPublishedEvent(store, eventData('Earlier', '2026-12-04'), [tierData('General', 100, 1)]);

  assert.deepEqual(sortEvents(listEventSummaries(store), 'date').map((event) => event.title), ['Earlier', 'Alpha', 'Zulu']);
});

test('S05: a date-only end filter includes events throughout that day', () => {
  const store = createStore();
  createPublishedEvent(store, eventData('Afternoon Event', '2026-12-05T17:00:00Z'), [tierData('General', 100, 1)]);

  assert.equal(filterEvents(listEventSummaries(store), { to: '2026-12-05' }).length, 1);
  assert.equal(filterEvents(listEventSummaries(store), { from: '2026-12-05', to: '2026-12-05' }).length, 1);
});

test('S05: bad dates, fractional prices, reversed ranges, and unknown sorts return VALIDATION', () => {
  const store = createStore();
  createPublishedEvent(store, eventData('Validation Event'), [tierData('General', 100, 1)]);
  const summaries = listEventSummaries(store);

  expectDomainError(() => filterEvents(summaries, { from: 'not-a-date' }), 'VALIDATION');
  expectDomainError(() => filterEvents(summaries, { maxPriceCents: 1.25 }), 'VALIDATION');
  expectDomainError(() => filterEvents(summaries, { from: '2026-12-06', to: '2026-12-05' }), 'VALIDATION');
  expectDomainError(() => sortEvents(summaries, 'random'), 'VALIDATION');
});

test('S05: filters and sorts return new lists without changing their input', () => {
  const store = createStore();
  createPublishedEvent(store, eventData('Second', '2026-12-06'), [tierData('General', 100, 1)]);
  createPublishedEvent(store, eventData('First'), [tierData('General', 100, 1)]);
  const summaries = listEventSummaries(store);
  const original = structuredClone(summaries);
  const filtered = filterEvents(summaries, { city: 'lagos' });
  const sorted = sortEvents(summaries, 'date');

  assert.notEqual(filtered, summaries);
  assert.notEqual(sorted, summaries);
  assert.deepEqual(summaries, original);
});

test('S05: availability sort puts the most remaining seats first with title and id tie-breaks', () => {
  const store = createStore();
  createPublishedEvent(store, eventData('B Event'), [tierData('General', 100, 4, 2)]);
  createPublishedEvent(store, eventData('A Event', '2026-12-06'), [tierData('General', 100, 4, 2)]);
  createPublishedEvent(store, eventData('Most Seats', '2026-12-07'), [tierData('General', 100, 5, 5)]);

  assert.deepEqual(sortEvents(listEventSummaries(store), 'availability').map((event) => event.title), ['Most Seats', 'A Event', 'B Event']);
});

test('S05: onlyAvailable filters out sold-out events when enabled', () => {
  const store = createStore();
  createPublishedEvent(store, eventData('Available Event'), [tierData('General', 100, 2)]);
  const soldOutEvent = createPublishedEvent(store, eventData('Sold Out Event', '2026-12-06'), [tierData('General', 100, 1)]);
  const soldOutTier = [...store.tiers.values()].find((tier) => tier.eventId === soldOutEvent.id);
  bookTickets(store, { eventId: soldOutEvent.id, tierId: soldOutTier.id, attendeeName: 'Ada', quantity: 1 });

  assert.deepEqual(filterEvents(listEventSummaries(store), { onlyAvailable: true }).map((event) => event.title), ['Available Event']);
  assert.deepEqual(filterEvents(listEventSummaries(store), { onlyAvailable: false }).map((event) => event.title), ['Available Event', 'Sold Out Event']);
});

test('S05: empty input returns a new empty result for filtering, sorting, and searching', () => {
  const empty = [];

  assert.deepEqual(filterEvents(empty, {}), []);
  assert.notEqual(filterEvents(empty, {}), empty);
  assert.deepEqual(sortEvents(empty, 'date'), []);
  assert.deepEqual(searchEvents(empty, {}, 'price'), []);
});

test('mergeSort is stable, returns a new array, and does not mutate its input', () => {
  const items = [
    { key: 2, label: 'first two' },
    { key: 1, label: 'one' },
    { key: 2, label: 'second two' },
  ];
  const original = structuredClone(items);
  const sorted = mergeSort(items, (left, right) => left.key - right.key);

  assert.notEqual(sorted, items);
  assert.deepEqual(sorted.map((item) => item.label), ['one', 'first two', 'second two']);
  assert.deepEqual(items, original);
});

test('S06: booking two of three published seats is pending, priced in cents, and leaves one', () => {
  const store = createStore();
  const event = createPublishedEvent(store, eventData('Bookable'), [tierData('General', 500000, 3)]);
  const tier = [...store.tiers.values()][0];
  const booking = bookTickets(store, { eventId: event.id, tierId: tier.id, attendeeName: 'Ada', quantity: 2 });

  assert.equal(booking.status, 'PENDING');
  assert.equal(booking.quantity, 2);
  assert.equal(booking.totalCents, 1000000);
  assert.equal(tier.sold, 2);
  assert.equal(tier.available, 1);
});

test('cancelling a pending booking restores sold and available counts exactly once', () => {
  const store = createStore();
  const event = createPublishedEvent(store, eventData('Cancellation'), [tierData('General', 500000, 3)]);
  const tier = [...store.tiers.values()][0];
  const booking = bookTickets(store, { eventId: event.id, tierId: tier.id, attendeeName: 'Ada', quantity: 2 });

  cancelBooking(store, booking.reference);
  assert.equal(tier.sold, 0);
  assert.equal(tier.available, 3);
  expectDomainError(() => cancelBooking(store, booking.reference), 'INVALID_STATE');
  assert.equal(tier.sold, 0);
  assert.equal(tier.available, 3);
});

test('joining a waitlist before a tier sells out returns NOT_SOLD_OUT', () => {
  const store = createStore();
  const event = createPublishedEvent(store, eventData('Not Sold Out'), [tierData('General', 100, 1)]);
  const tier = [...store.tiers.values()][0];

  assert.equal(event.id, tier.eventId);
  expectDomainError(() => joinWaitlist(store, { tierId: tier.id, attendeeName: 'Ada' }), 'NOT_SOLD_OUT');
});

test('S06: overselling returns SOLD_OUT and does not change seats or booking indexes', () => {
  const store = createStore();
  const event = createPublishedEvent(store, eventData('Last Seat'), [tierData('General', 500000, 1)]);
  const tier = [...store.tiers.values()][0];
  const before = { available: tier.available, bookings: store.bookings.size, references: store.bookingsByReference.size };

  expectDomainError(() => bookTickets(store, { eventId: event.id, tierId: tier.id, attendeeName: 'Bayo', quantity: 2 }), 'SOLD_OUT');
  assert.deepEqual({ available: tier.available, bookings: store.bookings.size, references: store.bookingsByReference.size }, before);
});

test('S06: zero, negative, fractional, and over-limit quantities return VALIDATION without changes', () => {
  const store = createStore();
  const event = createPublishedEvent(store, eventData('Quantity Limits'), [tierData('General', 500000, 20)]);
  const tier = [...store.tiers.values()][0];

  for (const quantity of [0, -1, 1.5, 11]) {
    expectDomainError(() => bookTickets(store, { eventId: event.id, tierId: tier.id, attendeeName: 'Ada', quantity }), 'VALIDATION');
  }
  assert.equal(tier.available, 20);
  assert.equal(store.bookings.size, 0);
});

test('mergeSort rejects invalid inputs with DomainError VALIDATION', () => {
  expectDomainError(() => mergeSort('not an array', () => 0), 'VALIDATION');
  expectDomainError(() => mergeSort([], null), 'VALIDATION');
});