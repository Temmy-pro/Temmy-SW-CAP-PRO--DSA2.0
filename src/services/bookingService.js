import {
  bookTickets as bookDomainTickets,
  cancelBooking as cancelDomainBooking,
} from '../domain/inventory.js';
import { assertTransition } from '../domain/bookingStateMachine.js';
import { DomainError } from '../domain/errors.js';
import { loadDomainStore } from './domainStore.js';

function requireUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new DomainError('The x-user-id header is required.', 'VALIDATION');
  }

  return userId.trim();
}

function requireBookingOwner(booking, userId) {
  if (booking.attendeeId !== userId) {
    throw new DomainError('Only the attendee who made this booking may perform this action.', 'FORBIDDEN');
  }
}

export async function createBooking(repository, userId, bookingInput) {
  const attendeeId = requireUserId(userId);
  const store = await loadDomainStore(repository);
  const event = store.events.get(bookingInput?.eventId);

  if (event === undefined) {
    bookDomainTickets(store, { ...bookingInput, attendeeName: attendeeId });
  }
  if (event.status !== 'PUBLISHED') {
    throw new DomainError('Tickets can only be booked for published events.', 'INVALID_STATE');
  }

  const booking = bookDomainTickets(store, { ...bookingInput, attendeeName: attendeeId });
  booking.attendeeId = attendeeId;
  const tier = store.tiers.get(booking.tierId);
  await repository.saveTier(tier);
  return repository.saveBooking(booking);
}

export async function payForBooking(repository, paymentGateway, reference, userId, paymentInput = {}) {
  const booking = await repository.getBookingByReference(reference);
  if (booking === undefined) {
    throw new DomainError('Booking was not found.', 'NOT_FOUND');
  }
  requireBookingOwner(booking, requireUserId(userId));
  assertTransition(booking.status.toLowerCase(), 'paid');

  const result = await paymentGateway.charge({ decline: paymentInput?.decline === true });
  if (result.status === 'declined') {
    throw new DomainError('The mock payment was declined.', 'PAYMENT_DECLINED');
  }

  booking.status = 'PAID';
  return repository.saveBooking(booking);
}

export async function cancelUnpaidBooking(repository, reference, userId) {
  const attendeeId = requireUserId(userId);
  const store = await loadDomainStore(repository);
  const booking = store.bookingsByReference.get(reference);

  if (booking === undefined) {
    throw new DomainError('Booking was not found.', 'NOT_FOUND');
  }
  requireBookingOwner(booking, attendeeId);
  assertTransition(booking.status.toLowerCase(), 'cancelled');

  if (booking.status !== 'PENDING') {
    throw new DomainError('Only unpaid bookings can be cancelled.', 'INVALID_TRANSITION');
  }

  const cancelledBooking = cancelDomainBooking(store, reference);
  const tier = store.tiers.get(cancelledBooking.tierId);
  await repository.saveTier(tier);
  return repository.saveBooking(cancelledBooking);
}
