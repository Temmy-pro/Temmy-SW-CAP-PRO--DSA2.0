# Build 4 API examples

Start the server with `npm start`. The API listens on port 3000 by default.
Every request that acts for a user includes the temporary `x-user-id` header.
Prices are whole cents. The mock payment endpoint accepts a `decline` boolean;
it never accepts or receives card details.

## Create an event

```sh
curl -X POST http://localhost:3000/api/events \
  -H "content-type: application/json" \
  -H "x-user-id: organizer-1" \
  -d '{"title":"Lagos Tech Meetup","city":"Lagos","venue":"Central Hall","date":"2026-12-05"}'
```

## Add a ticket tier

Use the event `id` returned by the create call.

```sh
curl -X POST http://localhost:3000/api/events/EVENT_ID/tiers \
  -H "content-type: application/json" \
  -H "x-user-id: organizer-1" \
  -d '{"name":"General","priceCents":500000,"capacity":100}'
```

## Publish the event

```sh
curl -X POST http://localhost:3000/api/events/EVENT_ID/publish \
  -H "x-user-id: organizer-1"
```

## Search, filter and sort published events

```sh
curl "http://localhost:3000/api/events?q=meetup&city=Lagos&maxPriceCents=600000&onlyAvailable=true&sortBy=price"
```

Supported search parameters are `q`, `city`, inclusive `from` and `to` dates,
`maxPriceCents`, `onlyAvailable` (`true` or `false`), and `sortBy` (`date`,
`price`, or `availability`).

## Book tickets

Use the event `id` and tier `id` returned by earlier calls.

```sh
curl -X POST http://localhost:3000/api/bookings \
  -H "content-type: application/json" \
  -H "x-user-id: attendee-1" \
  -d '{"eventId":"EVENT_ID","tierId":"TIER_ID","quantity":2}'
```

## Pay for a booking

Use the booking `reference` returned by the book call. A declined attempt can
be simulated with `{"decline":true}` and leaves the booking pending.

```sh
curl -X POST http://localhost:3000/api/bookings/BOOKING_REFERENCE/pay \
  -H "content-type: application/json" \
  -H "x-user-id: attendee-1" \
  -d '{"decline":false}'
```

## Cancel an unpaid booking

```sh
curl -X POST http://localhost:3000/api/bookings/BOOKING_REFERENCE/cancel \
  -H "x-user-id: attendee-1"
```
