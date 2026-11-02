import {
  addTier as addDomainTier,
  createEvent as createDomainEvent,
  listEventSummaries,
  publishEvent as publishDomainEvent,
} from '../domain/inventory.js';
import { searchEvents } from '../domain/eventSearch.js';
import { DomainError } from '../domain/errors.js';
import { loadDomainStore } from './domainStore.js';

function requireUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new DomainError('The x-user-id header is required.', 'VALIDATION');
  }

  return userId.trim();
}

function requireOrganizer(store, eventId, userId) {
  const event = store.events.get(eventId);
  if (event === undefined) {
    throw new DomainError('Event was not found.', 'NOT_FOUND');
  }
  if (event.organizerId !== requireUserId(userId)) {
    throw new DomainError('Only the event organizer may perform this action.', 'FORBIDDEN');
  }
}

export async function createEvent(repository, userId, eventInput) {
  const store = await loadDomainStore(repository);
  const event = createDomainEvent(store, eventInput);
  event.organizerId = requireUserId(userId);
  return repository.saveEvent(event);
}

export async function addTier(repository, eventId, userId, tierInput) {
  const store = await loadDomainStore(repository);
  requireOrganizer(store, eventId, userId);
  const tier = addDomainTier(store, eventId, tierInput);
  return repository.saveTier(tier);
}

export async function publishEvent(repository, eventId, userId) {
  const store = await loadDomainStore(repository);
  requireOrganizer(store, eventId, userId);
  const event = publishDomainEvent(store, eventId);
  return repository.saveEvent(event);
}

export async function searchPublishedEvents(repository, criteria = {}, sortBy = 'date') {
  const store = await loadDomainStore(repository);
  return searchEvents(listEventSummaries(store), criteria, sortBy);
}
