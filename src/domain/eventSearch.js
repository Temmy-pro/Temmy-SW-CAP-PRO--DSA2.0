import { DomainError } from './errors.js';
import { mergeSort } from './sorting.js';

function assertSummaries(summaries) {
  if (!Array.isArray(summaries)) {
    throw new DomainError('Event summaries must be an array.', 'VALIDATION');
  }

  for (const summary of summaries) {
    if (
      summary === null
      || typeof summary !== 'object'
      || typeof summary.id !== 'string'
      || typeof summary.title !== 'string'
      || typeof summary.date !== 'string'
      || !Array.isArray(summary.tiers)
    ) {
      throw new DomainError('Each event summary must include an id, title, date, and tiers array.', 'VALIDATION');
    }

    for (const tier of summary.tiers) {
      if (
        tier === null
        || typeof tier !== 'object'
        || !Number.isSafeInteger(tier.priceCents)
        || tier.priceCents < 0
        || !Number.isSafeInteger(tier.available)
        || tier.available < 0
      ) {
        throw new DomainError('Each tier must have a non-negative whole-cent price and available count.', 'VALIDATION');
      }
    }
  }
}

function parseIsoDate(value, label, includeWholeDay = false) {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)
  ) {
    throw new DomainError(`${label} must be a valid ISO date.`, 'VALIDATION');
  }

  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));

  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
    || !Number.isFinite(Date.parse(value))
  ) {
    throw new DomainError(`${label} must be a valid ISO date.`, 'VALIDATION');
  }

  if (includeWholeDay && value.length === 10) {
    return Date.UTC(year, month - 1, day + 1) - 1;
  }

  return Date.parse(value);
}

function getMetrics(summary) {
  let cheapestPriceCents = null;
  let available = 0;

  for (const tier of summary.tiers) {
    if (cheapestPriceCents === null || tier.priceCents < cheapestPriceCents) {
      cheapestPriceCents = tier.priceCents;
    }
    available += tier.available;
  }

  return { cheapestPriceCents, available };
}

function compareText(left, right) {
  return left.toLowerCase().localeCompare(right.toLowerCase());
}

function compareTitleAndId(left, right) {
  return compareText(left.title, right.title) || left.id.localeCompare(right.id);
}

export function filterEvents(summaries, criteria = {}) {
  assertSummaries(summaries);

  if (criteria === null || typeof criteria !== 'object' || Array.isArray(criteria)) {
    throw new DomainError('Search criteria must be an object.', 'VALIDATION');
  }

  const { q, city, from, to, maxPriceCents, onlyAvailable } = criteria;

  if (q !== undefined && typeof q !== 'string') {
    throw new DomainError('Search text must be a string.', 'VALIDATION');
  }

  if (city !== undefined && typeof city !== 'string') {
    throw new DomainError('City must be a string.', 'VALIDATION');
  }

  if (from !== undefined && from !== '') {
    parseIsoDate(from, 'Start date');
  }

  if (to !== undefined && to !== '') {
    parseIsoDate(to, 'End date', true);
  }

  if (
    maxPriceCents !== undefined
    && (!Number.isSafeInteger(maxPriceCents) || maxPriceCents < 0)
  ) {
    throw new DomainError('Maximum price must be a non-negative whole number of cents.', 'VALIDATION');
  }

  if (onlyAvailable !== undefined && typeof onlyAvailable !== 'boolean') {
    throw new DomainError('onlyAvailable must be a boolean.', 'VALIDATION');
  }

  const fromTime = from === undefined || from === '' ? null : parseIsoDate(from, 'Start date');
  const toTime = to === undefined || to === '' ? null : parseIsoDate(to, 'End date', true);

  if (fromTime !== null && toTime !== null && fromTime > toTime) {
    throw new DomainError('Start date must not be after end date.', 'VALIDATION');
  }

  const searchText = q?.trim().toLowerCase();
  const searchCity = city?.trim().toLowerCase();

  return summaries.filter((summary) => {
    const eventTime = parseIsoDate(summary.date, 'Event date');
    const metrics = getMetrics(summary);

    if (
      searchText
      && !summary.title.toLowerCase().includes(searchText)
      && !(typeof summary.venue === 'string' && summary.venue.toLowerCase().includes(searchText))
    ) {
      return false;
    }

    if (searchCity && (typeof summary.city !== 'string' || summary.city.trim().toLowerCase() !== searchCity)) {
      return false;
    }

    if (fromTime !== null && eventTime < fromTime) {
      return false;
    }

    if (toTime !== null && eventTime > toTime) {
      return false;
    }

    if (maxPriceCents !== undefined && (metrics.cheapestPriceCents === null || metrics.cheapestPriceCents > maxPriceCents)) {
      return false;
    }

    if (onlyAvailable === true && metrics.available === 0) {
      return false;
    }

    return true;
  });
}

export function sortEvents(summaries, sortBy) {
  assertSummaries(summaries);

  if (!['date', 'price', 'availability'].includes(sortBy)) {
    throw new DomainError('Sort option must be date, price, or availability.', 'VALIDATION');
  }

  const compare = (left, right) => {
    let order = 0;

    if (sortBy === 'date') {
      order = parseIsoDate(left.date, 'Event date') - parseIsoDate(right.date, 'Event date');
    } else if (sortBy === 'price') {
      const leftPrice = getMetrics(left).cheapestPriceCents;
      const rightPrice = getMetrics(right).cheapestPriceCents;
      if (leftPrice === null || rightPrice === null) {
        order = leftPrice === rightPrice ? 0 : leftPrice === null ? 1 : -1;
      } else {
        order = leftPrice - rightPrice;
      }
    } else {
      order = getMetrics(right).available - getMetrics(left).available;
    }

    return order || compareTitleAndId(left, right);
  };

  return mergeSort(summaries, compare);
}

export function searchEvents(summaries, criteria = {}, sortBy = 'date') {
  return sortEvents(filterEvents(summaries, criteria), sortBy);
}