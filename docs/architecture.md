# Application Architecture

## Layers

```mermaid
flowchart TD
  Client[Browser or API client] --> Routes[HTTP routes]
  Routes --> Services[Application services]
  Services --> Rules[Domain rules]
  Services --> Repositories[Repositories]
  Repositories --> Data[(In-memory store now, database later)]
```

- **Routes** may validate HTTP-specific input and translate results to HTTP responses; they may not contain business rules or access storage directly.
- **Services** may coordinate domain rules and repositories; they may not depend on HTTP request/response objects or call routes.
- **Domain rules** may enforce business invariants using plain values; they may not perform I/O or depend on services, repositories, or HTTP.
- **Repositories** may read and write data; they may not decide business policy or call services and routes.

## Data Model

```mermaid
erDiagram
  USERS ||--o{ EVENTS : organizes
  USERS ||--o{ BOOKINGS : places
  EVENTS ||--|{ TICKET_TIERS : offers
  EVENTS ||--o{ BOOKINGS : receives
  TICKET_TIERS ||--o{ BOOKINGS : reserves
  USERS {
    string id
    string name
    string email
    string role
  }
  EVENTS {
    string id
    string title
    string city
    string venue
    datetime date
    string status
    string organizer_id
  }
  TICKET_TIERS {
    string id
    string event_id
    string name
    integer price_cents
    integer capacity
    integer sold
  }
  BOOKINGS {
    string id
    string reference
    string attendee_id
    string event_id
    string tier_id
    integer quantity
    integer total_cents
    string status
  }
```

## Booking Life Cycle

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> paid
  pending --> cancelled
  paid --> checked_in
  paid --> refunded
  paid --> cancelled
  state "cancelled (final)" as cancelled
  state "refunded (final)" as refunded
  state "checked_in (final)" as checked_in
```