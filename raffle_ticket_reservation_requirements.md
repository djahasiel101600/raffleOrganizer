# Project Requirements Document
# Raffle Ticket Reservation System

## 1. Project Overview

**System Name:** Raffle Ticket Reservation

**Purpose:**  
A simple, intuitive web-based system for managing raffle ticket number reservations. The system is intended for an administrator or authorized staff member who manually reserves ticket numbers for customers.

The system must make it easy to:

- Reserve one or multiple raffle ticket numbers for a customer.
- Prevent the same ticket number from being reserved more than once.
- Monitor reservations in real time.
- Search and review existing reservations.
- Print reserved raffle tickets.
- Configure how many tickets are printed per column.

The system should remain **simple and practical**, avoiding unnecessary features and complexity.

---

## 2. Technology Stack

### Backend

- **Python**
- **Django**
- **Django REST Framework**
- **Django ORM**
- **SQLite** for initial/simple deployment, with PostgreSQL-compatible configuration if needed later
- RESTful API architecture

### Frontend

- **React**
- **Vite**
- **TypeScript**
- **Shadcn UI**
- Tailwind CSS
- React Router

### Real-Time Communication

Use a lightweight real-time mechanism appropriate for Django, preferably:

- **Django Channels**
- WebSockets

Real-time functionality should be limited to reservation updates and should not introduce unnecessary complexity.

---

# 3. User Roles

## 3.1 Administrator / Reservation Staff

The primary user of the system.

The administrator can:

- Create customer reservations.
- Select or enter ticket numbers.
- View available and reserved tickets.
- Search reservations.
- View reservation details.
- Monitor reservations in real time.
- Print tickets.
- Cancel or correct reservations if permitted.

## 3.2 Public / Monitoring Viewer

An optional read-only interface for displaying reservation activity.

The monitoring page:

- Does not allow reservations.
- Does not allow editing.
- Displays ticket reservation activity in real time.
- Can be displayed on another monitor, television, or projector.

Authentication is not required for the monitoring display if it is intentionally exposed as a read-only monitoring screen. If the deployment requires privacy, authentication may be added.

---

# 4. Core Requirements

## 4.1 Ticket Number Management

The system must support a configurable range of raffle ticket numbers.

Example:

```text
0001 - 1000
```

or

```text
1 - 5000
```

### Requirements

- Admin can configure the starting ticket number.
- Admin can configure the ending ticket number.
- Ticket numbers should retain their configured display format.
- Ticket numbers must be unique.
- A ticket can have only one active reservation.
- A reserved ticket cannot be reserved again.
- The system must validate ticket availability before creating a reservation.

### Ticket Status

Each ticket should have one of at least these statuses:

- **Available**
- **Reserved**

A cancelled reservation should make its ticket numbers available again unless the system is configured to retain them as permanently used.

For the initial version, cancellation should return the ticket number to **Available**.

---

# 5. Customer Reservation

## 5.1 Create Reservation

The administrator should have a simple reservation form.

### Required Information

- Customer Name
- Ticket Number(s)

### Optional Information

- Contact Number
- Notes

Example:

```text
Customer Name: Juan Dela Cruz
Contact Number: 09123456789

Ticket Numbers:
0001
0002
0003
0004
0005

Notes:
Reserved for church member.
```

### Reservation Behavior

When the administrator submits the reservation:

1. The system validates the customer information.
2. The system checks all requested ticket numbers.
3. The system verifies that none of the ticket numbers are already reserved.
4. If all requested tickets are available, the reservation is created.
5. The selected ticket numbers become reserved immediately.
6. The system broadcasts the reservation update to connected monitoring pages.
7. The administrator receives a clear success message.

If one or more requested tickets are already reserved, the reservation should **not partially succeed**.

Example:

```text
Tickets 0001-0005 requested.

0001 Available
0002 Available
0003 RESERVED
0004 Available
0005 Available
```

The system should reject the entire reservation and clearly show:

```text
Unable to reserve tickets.

Ticket 0003 is already reserved.
```

The administrator can then modify the selection.

---

# 6. Ticket Selection Interface

The ticket selection interface should be designed for speed and ease of use.

## Recommended Interface

Display tickets in a grid:

```text
┌──────┬──────┬──────┬──────┬──────┐
│ 0001 │ 0002 │ 0003 │ 0004 │ 0005 │
├──────┼──────┼──────┼──────┼──────┤
│ 0006 │ 0007 │ 0008 │ 0009 │ 0010 │
├──────┼──────┼──────┼──────┼──────┤
│ 0011 │ 0012 │ 0013 │ 0014 │ 0015 │
└──────┴──────┴──────┴──────┴──────┘
```

Ticket appearance should clearly distinguish:

- Available
- Selected
- Reserved

Example conceptual states:

```text
Available  → selectable
Selected   → selected for current reservation
Reserved   → disabled / cannot be selected
```

## Ticket Number Input

The administrator should also be able to enter ticket numbers directly.

Example:

```text
Enter ticket numbers:
1, 2, 3, 10-15
```

The system should interpret ranges where practical.

This is especially useful when an administrator needs to reserve many consecutive numbers.

---

# 7. Reservation List

The system must provide a reservation list for reviewing existing reservations.

### Suggested Columns

| Column | Description |
|---|---|
| Reservation ID | Unique reservation identifier |
| Customer | Customer name |
| Contact | Customer contact number |
| Tickets | Number of tickets reserved |
| Ticket Numbers | Reserved ticket numbers |
| Reserved At | Date and time of reservation |
| Status | Active / Cancelled |
| Actions | View, Print, Cancel |

The list should support:

- Search by customer name.
- Search by contact number.
- Search by ticket number.
- Filtering by reservation status.
- Sorting by newest reservation.
- Pagination when the number of records becomes large.

---

# 8. Reservation Details

Clicking a reservation should display its complete details.

Example:

```text
Reservation #R-000123

Customer:
Juan Dela Cruz

Contact:
09123456789

Tickets:
0001
0002
0003
0004
0005

Total Tickets:
5

Reserved:
September 6, 2026 8:30 PM

Status:
Reserved
```

Available actions:

- Print Tickets
- Cancel Reservation
- Return to Reservation List

---

# 9. Real-Time Reservation Monitoring

The system must provide a dedicated page for monitoring reservations in real time.

## Purpose

This page is intended to be displayed on:

- A second monitor.
- Television.
- Projector.
- Another computer.
- A browser window used for event monitoring.

## Requirements

When a reservation is created:

- The monitoring page should update automatically.
- No manual page refresh should be required.
- Newly reserved tickets should become visibly reserved.
- Recent reservation information should appear automatically.

When a reservation is cancelled:

- The monitoring page should reflect the change automatically.

## Monitoring Display

The page should prioritize visibility over detailed administration.

Example:

```text
RAFFLE TICKET RESERVATION MONITOR

Total Tickets: 1,000
Reserved: 327
Available: 673

----------------------------------

RECENT RESERVATIONS

Juan Dela Cruz
Tickets: 0001 - 0005
5 Tickets
8:30 PM

Maria Santos
Tickets: 0010 - 0015
6 Tickets
8:27 PM

Pedro Cruz
Tickets: 0020 - 0022
3 Tickets
8:25 PM
```

The display should automatically update using WebSockets.

A small connection indicator may be displayed:

```text
● LIVE
```

or

```text
● CONNECTED
```

If the connection is lost:

```text
○ RECONNECTING...
```

The frontend should automatically attempt to reconnect.

---

# 10. Ticket Status Dashboard

The administrator dashboard should provide a quick overview.

### Statistics

Display:

```text
Total Tickets
1,000

Reserved
327

Available
673

Reservations
84
```

Optional progress indicator:

```text
████████░░░░░░░░ 32.7% Reserved
```

The dashboard should update when reservations change.

---

# 11. Printing Requirements

The system must allow the administrator to print raffle tickets.

## 11.1 Print Selected Reservation

From a reservation, the administrator can select:

```text
Print Tickets
```

The system generates a print-friendly layout containing the reserved ticket numbers.

Example:

```text
┌─────────────────────┐
│      RAFFLE DRAW    │
│                     │
│      TICKET         │
│                     │
│       0001          │
│                     │
│   Keep this ticket  │
└─────────────────────┘
```

## 11.2 Multiple Tickets

If a reservation contains multiple ticket numbers, each ticket number should generate one printable ticket.

Example:

```text
0001    0002    0003
0004    0005    0006
```

---

# 12. Adjustable Tickets Per Column

The printing interface must allow the administrator to specify the number of tickets per column.

Example options:

```text
Tickets per column:
[ 2 ▼ ]
```

Possible values:

```text
1
2
3
4
5
6
```

The system should adapt the print layout accordingly.

For example:

### 2 Tickets Per Column

```text
┌──────────────┐
│    TICKET    │
│     0001     │
└──────────────┘

┌──────────────┐
│    TICKET    │
│     0002     │
└──────────────┘
```

### 4 Tickets Per Column

```text
┌──────────────┐
│    TICKET    │
│     0001     │
└──────────────┘

┌──────────────┐
│    TICKET    │
│     0002     │
└──────────────┘

┌──────────────┐
│    TICKET    │
│     0003     │
└──────────────┘

┌──────────────┐
│    TICKET    │
│     0004     │
└──────────────┘
```

The print layout should use CSS print styles so that the browser's native print dialog can be used.

---

# 13. Print Preview

Before printing, the administrator should be able to see a print preview.

The preview should allow:

- Tickets per column.
- Viewing the ticket layout.
- Printing.
- Returning to the previous page.

The system does not need a complicated PDF-generation engine for the initial version. Browser-based printing using a dedicated print layout is preferred.

PDF generation can be considered later if required.

---

# 14. Data Model

The initial database should remain simple.

## 14.1 Ticket

Suggested fields:

```text
Ticket
-------
id
number
status
created_at
updated_at
```

### Fields

| Field | Type | Description |
|---|---|---|
| id | Integer / UUID | Primary key |
| number | Integer | Actual ticket number |
| status | Choice | Available / Reserved |
| created_at | DateTime | Creation date |
| updated_at | DateTime | Last update |

The `number` field must have a unique constraint.

---

## 14.2 Reservation

```text
Reservation
-----------
id
customer_name
contact_number
notes
status
created_at
updated_at
```

### Fields

| Field | Type | Description |
|---|---|---|
| id | Integer / UUID | Primary key |
| customer_name | String | Customer name |
| contact_number | String | Optional contact number |
| notes | Text | Optional notes |
| status | Choice | Active / Cancelled |
| created_at | DateTime | Reservation date/time |
| updated_at | DateTime | Last update |

---

## 14.3 ReservationTicket

A separate relationship model should connect reservations to tickets.

```text
ReservationTicket
-----------------
id
reservation
ticket
created_at
```

Constraints:

- A ticket should not belong to more than one active reservation.
- The database should enforce uniqueness where appropriate.
- Reservation creation should use a database transaction.

This prevents duplicate reservations caused by two administrators attempting to reserve the same ticket at nearly the same time.

---

# 15. Backend API Requirements

The backend should expose a REST API.

## Authentication

Admin endpoints should require authentication.

A simple token-based authentication mechanism such as JWT may be used.

The monitoring endpoint may be read-only and optionally unauthenticated.

---

## Suggested API Endpoints

### Authentication

```http
POST /api/auth/login/
POST /api/auth/refresh/
```

### Dashboard

```http
GET /api/dashboard/
```

Example response:

```json
{
  "total_tickets": 1000,
  "reserved_tickets": 327,
  "available_tickets": 673,
  "total_reservations": 84
}
```

### Tickets

```http
GET /api/tickets/
GET /api/tickets/{id}/
```

Optional filters:

```text
?status=available
?status=reserved
?search=100
```

### Reservations

```http
GET /api/reservations/
POST /api/reservations/
GET /api/reservations/{id}/
POST /api/reservations/{id}/cancel/
```

### Monitoring

The monitoring page may consume:

```http
GET /api/monitor/
```

and receive live updates through a WebSocket endpoint such as:

```text
/ws/reservations/
```

---

# 16. Reservation API Behavior

A reservation request may look like:

```json
{
  "customer_name": "Juan Dela Cruz",
  "contact_number": "09123456789",
  "ticket_numbers": [1, 2, 3, 4, 5],
  "notes": "Reserved for event"
}
```

The backend must:

1. Validate the request.
2. Verify all ticket numbers exist.
3. Verify all tickets are available.
4. Start a database transaction.
5. Create the reservation.
6. Reserve the tickets.
7. Commit the transaction.
8. Broadcast the reservation event.
9. Return the reservation information.

If any ticket is unavailable, the transaction must fail without reserving any tickets.

---

# 17. Real-Time Event

When a reservation is successfully created, the backend should broadcast an event similar to:

```json
{
  "type": "reservation_created",
  "reservation_id": 123,
  "customer_name": "Juan Dela Cruz",
  "ticket_numbers": [1, 2, 3, 4, 5],
  "reserved_count": 5,
  "reserved_at": "2026-09-06T20:30:00+08:00"
}
```

When a reservation is cancelled:

```json
{
  "type": "reservation_cancelled",
  "reservation_id": 123,
  "ticket_numbers": [1, 2, 3, 4, 5]
}
```

The React application should update its state immediately when these events are received.

---

# 18. Frontend Pages

The application should contain the following primary pages.

## 18.1 Login

Simple login page for administrators.

Components:

- Username/email
- Password
- Login button
- Error message

---

## 18.2 Dashboard

Provides:

- Ticket statistics.
- Reservation statistics.
- Quick reservation button.
- Recent reservations.
- Link to ticket management.
- Link to monitoring page.
- Link to printing/reservations.

---

## 18.3 New Reservation

Main working page for the administrator.

Components:

- Customer information form.
- Ticket search/input.
- Ticket selection grid.
- Selected ticket list.
- Ticket count.
- Reservation button.

Example:

```text
New Reservation

Customer Name
[ Juan Dela Cruz                 ]

Contact Number
[ 09123456789                    ]

Select Tickets

[ Search ticket... ]

[0001] [0002] [0003] [0004] [0005]
[0006] [0007] [0008] [0009] [0010]

Selected:
0001, 0002, 0003

Total: 3 tickets

[ Clear ]              [ Reserve Tickets ]
```

---

## 18.4 Reservations

Displays all reservations.

Features:

- Search.
- Filters.
- Pagination.
- View details.
- Print.
- Cancel.

---

## 18.5 Reservation Details

Displays one reservation and its tickets.

Actions:

- Print.
- Cancel.
- Back.

---

## 18.6 Ticket Monitor

Designed for real-time viewing.

Features:

- Total tickets.
- Reserved tickets.
- Available tickets.
- Reservation percentage.
- Recent reservation activity.
- Live ticket status.
- Connection status.

---

## 18.7 Print Preview

Features:

- Ticket preview.
- Tickets per column selector.
- Print button.
- Cancel/back button.

---

# 19. Navigation

Use a simple sidebar or top navigation.

Suggested navigation:

```text
Dashboard
New Reservation
Reservations
Ticket Monitor
```

Secondary actions:

```text
Settings
Logout
```

Avoid creating a large number of menu items.

---

# 20. UI/UX Requirements

The interface should prioritize **speed, clarity, and low learning effort**.

## Shadcn UI Components

Use Shadcn UI components where appropriate:

- Button
- Input
- Label
- Card
- Table
- Dialog
- Alert Dialog
- Badge
- Select
- Dropdown Menu
- Tabs
- Toast / Sonner
- Checkbox
- Skeleton
- Pagination

Do not use components merely for the sake of using them.

---

# 21. Feedback and Error Handling

Every important operation should provide clear feedback.

### Successful Reservation

```text
✓ Reservation successful.

5 tickets reserved for Juan Dela Cruz.
```

### Duplicate Ticket

```text
Unable to reserve tickets.

Ticket 0025 is already reserved.
```

### Invalid Ticket

```text
Ticket 9999 does not exist.
```

### Network Error

```text
Unable to connect to the server.

Please check your connection and try again.
```

### Real-Time Connection

Display an unobtrusive status indicator:

```text
● Live
```

or:

```text
○ Reconnecting...
```

---

# 22. Validation Requirements

The backend must always perform validation even if the frontend validates the same information.

### Customer Name

- Required.
- Must not be blank.

### Contact Number

- Optional.
- Store as text rather than an integer.

### Ticket Numbers

- Required.
- Must exist.
- Must be available.
- Duplicate numbers within the same request must be removed or rejected clearly.

### Reservation

- Must contain at least one ticket.
- Must not partially reserve tickets.

---

# 23. Security Requirements

The system should implement basic security without over-engineering.

### Requirements

- Admin pages require authentication.
- Passwords must use Django's built-in password hashing.
- Django CSRF protection should be maintained where applicable.
- API permissions must be enforced server-side.
- Ticket reservation must be protected against race conditions.
- Do not trust ticket availability information sent by the frontend.
- All reservation changes must be validated by the backend.

---

# 24. Concurrency and Duplicate Reservation Protection

This is a critical requirement.

Two administrators could potentially attempt to reserve the same ticket at the same time.

The backend must ensure that:

```text
Admin A → Ticket 0050
Admin B → Ticket 0050
```

cannot result in both reservations succeeding.

Use:

- Django database transactions.
- Appropriate row locking / atomic operations.
- Database-level uniqueness constraints where appropriate.

The frontend's "Reserved" status must never be considered sufficient protection.

The database/backend is the final authority on ticket availability.

---

# 25. Audit Information

The system should preserve basic reservation history.

For each reservation:

- Reservation ID.
- Customer name.
- Ticket numbers.
- Date/time created.
- Status.
- Date/time cancelled, if applicable.

A full enterprise audit-log system is **not required** for the initial version.

---

# 26. Settings

Keep settings minimal.

Suggested settings:

```text
Raffle Settings

Raffle Name:
[ Annual Community Raffle ]

Starting Ticket Number:
[ 1 ]

Ending Ticket Number:
[ 1000 ]

Ticket Number Padding:
[ 4 ]

Default Tickets Per Column:
[ 3 ]
```

Example:

```text
1 → 0001
25 → 0025
100 → 0100
1000 → 1000
```

Changing ticket range should not accidentally destroy existing reservations.

If tickets already exist, the system should warn the administrator before changing the range.

---

# 27. Ticket Initialization

When the administrator creates a new raffle ticket range:

```text
Start: 1
End: 1000
Padding: 4
```

The system creates:

```text
0001
0002
0003
...
1000
```

All tickets initially have:

```text
status = Available
```

The system should not generate duplicate ticket numbers.

---

# 28. Printing Design Requirements

The printing system should be intentionally simple.

### Requirements

- Print only the requested tickets.
- Ticket number must be highly visible.
- Support configurable tickets per column.
- Include raffle name.
- Allow a simple ticket design.
- Use print-specific CSS.
- Hide navigation and application controls during printing.
- Avoid unnecessary graphics that could make printing slow or expensive.

### Example

```text
+---------------------------+
|      ANNUAL RAFFLE        |
|                           |
|          TICKET           |
|                           |
|          000123           |
|                           |
|     Keep this ticket.     |
+---------------------------+
```

The design should be easy to modify later.

---

# 29. Responsive Design

The system should work on:

- Desktop.
- Laptop.
- Tablet.

The primary administrator workflow is desktop-oriented.

The monitoring page should also work well on large displays.

Mobile support is desirable but does not need to be the primary design target.

---

# 30. Performance Requirements

The system should remain responsive for a typical raffle containing thousands of tickets.

The implementation should support at least:

- 1,000 tickets comfortably.
- 10,000 tickets without requiring architectural changes.

The ticket grid should use pagination, virtualization, filtering, or another simple optimization if displaying very large ticket ranges becomes slow.

Do not load unnecessarily large datasets on every page.

---

# 31. Suggested Project Structure

## Backend

```text
backend/
├── manage.py
├── config/
│   ├── settings.py
│   ├── urls.py
│   ├── asgi.py
│   └── routing.py
│
├── accounts/
├── raffle/
│   ├── models.py
│   ├── serializers.py
│   ├── views.py
│   ├── urls.py
│   ├── consumers.py
│   ├── routing.py
│   ├── services.py
│   └── admin.py
│
└── requirements.txt
```

Business logic related to reservation should preferably be kept in a service layer such as:

```text
raffle/services.py
```

This prevents reservation logic from becoming scattered across serializers and views.

---

## Frontend

```text
frontend/
├── src/
│   ├── components/
│   ├── components/ui/
│   ├── layouts/
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Dashboard.tsx
│   │   ├── NewReservation.tsx
│   │   ├── Reservations.tsx
│   │   ├── ReservationDetails.tsx
│   │   ├── TicketMonitor.tsx
│   │   └── PrintPreview.tsx
│   │
│   ├── hooks/
│   ├── services/
│   │   ├── api.ts
│   │   └── websocket.ts
│   ├── types/
│   ├── lib/
│   ├── App.tsx
│   └── main.tsx
│
├── package.json
└── vite.config.ts
```

---

# 32. API Client

The frontend should have a centralized API client rather than calling `fetch()` directly throughout components.

Example conceptual structure:

```text
services/
├── api.ts
├── tickets.ts
├── reservations.ts
└── dashboard.ts
```

This keeps API communication organized and easier to maintain.

---

# 33. State Management

Do not introduce a large state-management framework unless necessary.

For the initial implementation:

- React state.
- React context where appropriate.
- Server state/query library only if genuinely useful.

The application does not require complex global state.

---

# 34. Error and Loading States

Every API-driven page should handle:

- Loading.
- Success.
- Empty state.
- Error.

Example empty reservation state:

```text
No reservations found.

Reservations will appear here after tickets are reserved.
```

Use Shadcn UI skeletons or simple loading indicators where appropriate.

---

# 35. Non-Functional Requirements

## Simplicity

The system must avoid unnecessary features.

Do **not** initially include:

- Customer self-service reservation.
- Online payments.
- SMS integration.
- Email notifications.
- Complex reporting.
- Multi-organization support.
- Complex role hierarchies.
- Loyalty programs.
- Customer accounts.
- Inventory management unrelated to raffle tickets.

These can be considered future enhancements if actual requirements emerge.

---

# 36. Recommended User Workflow

The primary workflow should be:

```text
Login
  ↓
Dashboard
  ↓
New Reservation
  ↓
Enter Customer Information
  ↓
Select Ticket Numbers
  ↓
Review Selected Tickets
  ↓
Reserve Tickets
  ↓
Reservation Successful
  ↓
Print Tickets
```

At the same time:

```text
Ticket Monitor
      ↓
Receives WebSocket Event
      ↓
Updates Automatically
```

---

# 37. Acceptance Criteria

The project is considered functionally complete when the following scenarios work correctly.

## Reservation

- [ ] Administrator can log in.
- [ ] Administrator can create a reservation.
- [ ] Administrator can select one ticket.
- [ ] Administrator can select multiple tickets.
- [ ] Administrator can enter ticket numbers directly.
- [ ] System prevents reservation of unavailable tickets.
- [ ] System prevents duplicate ticket reservations.
- [ ] Reservation is stored in the database.
- [ ] Reserved tickets become unavailable immediately.

## Reservation Management

- [ ] Administrator can view all reservations.
- [ ] Administrator can search reservations.
- [ ] Administrator can view reservation details.
- [ ] Administrator can cancel a reservation.
- [ ] Cancelled tickets become available again.

## Real-Time Monitoring

- [ ] Monitoring page displays ticket statistics.
- [ ] New reservations appear automatically.
- [ ] Ticket status updates without refreshing.
- [ ] Cancelled reservations update automatically.
- [ ] WebSocket reconnection is handled gracefully.

## Printing

- [ ] Administrator can print a reservation.
- [ ] Each reserved ticket is represented in the print layout.
- [ ] Ticket number is clearly visible.
- [ ] Administrator can select tickets per column.
- [ ] Print preview reflects the selected layout.
- [ ] Application navigation is hidden when printing.

## Data Integrity

- [ ] Ticket numbers are unique.
- [ ] Concurrent reservation attempts cannot reserve the same ticket twice.
- [ ] Failed reservations do not partially reserve tickets.
- [ ] Existing reservations remain intact after normal application restarts.

---

# 38. Development Priorities

Development should follow this order:

### Phase 1 — Foundation

- Django project.
- Django REST Framework.
- React/Vite/TypeScript project.
- Shadcn UI setup.
- Database models.
- Authentication.

### Phase 2 — Ticket Management

- Ticket generation.
- Ticket status.
- Ticket API.
- Ticket selection interface.

### Phase 3 — Reservation

- Reservation API.
- Transaction-safe ticket reservation.
- Reservation form.
- Reservation list.
- Reservation details.
- Cancellation.

### Phase 4 — Real-Time Monitoring

- Django Channels.
- WebSocket connection.
- Reservation events.
- Real-time dashboard updates.

### Phase 5 — Printing

- Print layout.
- Ticket template.
- Print preview.
- Tickets-per-column configuration.

### Phase 6 — Refinement

- Error handling.
- Loading states.
- Responsive improvements.
- UI consistency.
- Basic testing.
- Deployment configuration.

---

# 39. Testing Requirements

At minimum, test the following backend scenarios:

### Ticket Tests

- Ticket generation.
- Unique ticket numbers.
- Available ticket retrieval.
- Reserved ticket retrieval.

### Reservation Tests

- Single ticket reservation.
- Multiple ticket reservation.
- Duplicate ticket rejection.
- Already-reserved ticket rejection.
- Invalid ticket rejection.
- Empty ticket selection rejection.
- Cancellation.
- Ticket availability after cancellation.

### Concurrency Test

Test two reservation requests attempting to reserve the same ticket simultaneously.

Expected result:

```text
Request A → SUCCESS
Request B → REJECTED
```

Never:

```text
Request A → SUCCESS
Request B → SUCCESS
```

### Frontend Tests

At minimum verify:

- Login flow.
- Reservation flow.
- Ticket selection.
- Error messages.
- Reservation list.
- Real-time update behavior.
- Print layout.

---

# 40. Deployment

The application should be deployable as a simple web application.

Recommended production architecture:

```text
Browser
   │
   ▼
Nginx
   │
   ├── React Static Files
   │
   └── Django
         │
         ├── REST API
         └── WebSocket
                │
                ▼
             Database
```

For development:

```text
React Vite
     │
     ▼
Django API
     │
     ▼
SQLite
```

The system should support environment variables for:

- Django secret key.
- Debug mode.
- Allowed hosts.
- Database configuration.
- API URL.
- WebSocket URL.

---

# 41. Definition of Done

The project is complete when an administrator can perform the following end-to-end process without technical assistance:

1. Log into the system.
2. Open the reservation page.
3. Enter a customer's name.
4. Select or enter ticket numbers.
5. Successfully reserve available tickets.
6. Receive a clear confirmation.
7. See the tickets marked as reserved.
8. See the reservation appear on the monitoring screen in real time.
9. Open the reservation details.
10. Preview the tickets.
11. Select the desired number of tickets per column.
12. Print the tickets.
13. Cancel a reservation when necessary.
14. Confirm that cancelled tickets become available again.

The system should accomplish this with a clean, intuitive interface and without unnecessary configuration or administrative complexity.

---

# 42. Guiding Principle

> **Build the simplest system that reliably manages raffle ticket reservations.**

The primary goals are:

**Fast reservation → Accurate ticket tracking → Real-time visibility → Easy printing**

Every feature should be evaluated against these goals. If a feature does not directly support them, it should not be included in the initial version.
