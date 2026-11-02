import { createStore } from '../domain/inventory.js';

export async function loadDomainStore(repository) {
  const [events, tiers, bookings] = await Promise.all([
    repository.listEvents(),
    repository.listTiers(),
    repository.listBookings(),
  ]);
  const store = createStore();

  for (const event of events) store.events.set(event.id, event);
  for (const tier of tiers) store.tiers.set(tier.id, tier);
  for (const booking of bookings) {
    store.bookings.set(booking.id, booking);
    store.bookingsByReference.set(booking.reference, booking);
  }

  return store;
}
