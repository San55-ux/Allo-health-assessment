# Allo Health – Inventory Reservation System

## Tech Stack
Next.js 15 · TypeScript · Prisma 5 · PostgreSQL · Redis · Tailwind CSS

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create environment files

Create **both** files in the project root:

**`.env`** — used by Prisma CLI
```
DATABASE_URL="postgresql://..."
REDIS_URL="rediss://default:...@....upstash.io:6379"
CRON_SECRET="any-random-string"
```

**`.env.local`** — used by Next.js at runtime (same content)
```
DATABASE_URL="postgresql://..."
REDIS_URL="rediss://default:...@....upstash.io:6379"
CRON_SECRET="any-random-string"
```

> Free services: [neon.tech](https://neon.tech) for PostgreSQL · [upstash.com](https://upstash.com) for Redis

### 3. Push schema & seed data
```bash
npx prisma db push
npx prisma db seed
```

### 4. Run
```bash
npm run dev
# Open http://localhost:3000
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List all products with stock |
| GET | `/api/warehouses` | List all warehouses |
| POST | `/api/reservations` | Create a reservation |
| GET | `/api/reservations/:id` | Get reservation details |
| POST | `/api/reservations/:id/confirm` | Confirm a reservation |
| POST | `/api/reservations/:id/release` | Cancel a reservation |
| GET | `/api/cron/expire` | Release expired reservations (cron) |

### Reserve a product
```bash
POST /api/reservations
Content-Type: application/json
Idempotency-Key: any-unique-string   # optional

{
  "productId": "uuid",
  "warehouseId": "uuid",
  "quantity": 1
}
```

---

## Key Features

**Race condition safety** — Redis distributed lock (SET NX PX) ensures only one reservation can proceed per product+warehouse at a time.

**10-minute expiry** — Reservations auto-expire. Handled lazily on confirm (returns `410 Gone`) and via a cron job in production.

**Idempotency** — Pass `Idempotency-Key` header to safely retry requests without double-booking.

---

## Project Structure
```
app/
  page.tsx                        # Products listing
  checkout/[id]/page.tsx          # Checkout with countdown timer
  api/
    products/route.ts
    warehouses/route.ts
    reservations/
      route.ts                    # POST – create reservation
      [id]/route.ts               # GET – get reservation
      [id]/confirm/route.ts       # POST – confirm
      [id]/release/route.ts       # POST – release
    cron/expire/route.ts          # GET – cleanup expired
lib/
  prisma.ts                       # Prisma client singleton
  redis.ts                        # Redis client singleton
  schemas.ts                      # Zod validation
prisma/
  schema.prisma                   # DB schema
  seed.ts                         # Sample data
```
