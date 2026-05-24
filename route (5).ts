import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { ReserveSchema } from '@/lib/schemas'

const RESERVATION_TTL = 10 * 60 * 1000 // 10 minutes in ms
const LOCK_TTL = 5000 // 5 seconds lock

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = ReserveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { productId, warehouseId, quantity } = parsed.data
  const idempotencyKey = req.headers.get('Idempotency-Key')

  // Idempotency: return cached response if key already seen
  if (idempotencyKey) {
    const cached = await redis.get(`idempotency:${idempotencyKey}`)
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: { 'X-Idempotent-Replayed': 'true' }
      })
    }
  }

  // Distributed lock per product+warehouse to prevent race conditions
  const lockKey = `lock:${productId}:${warehouseId}`
  const lockValue = crypto.randomUUID()

  // Try to acquire lock (SET NX PX)
  const acquired = await redis.set(lockKey, lockValue, 'PX', LOCK_TTL, 'NX')
  if (!acquired) {
    return NextResponse.json({ error: 'Server busy, please retry' }, { status: 503 })
  }

  try {
    // Check stock inside lock
    const stock = await prisma.stock.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } }
    })

    if (!stock || (stock.total - stock.reserved) < quantity) {
      return NextResponse.json({ error: 'Not enough stock available' }, { status: 409 })
    }

    const expiresAt = new Date(Date.now() + RESERVATION_TTL)

    // Atomically increment reserved & create reservation
    const [reservation] = await prisma.$transaction([
      prisma.reservation.create({
        data: {
          productId,
          warehouseId,
          quantity,
          expiresAt,
          status: 'PENDING',
          idempotencyKey: idempotencyKey || undefined,
        },
        include: { product: true, warehouse: true }
      }),
      prisma.stock.update({
        where: { productId_warehouseId: { productId, warehouseId } },
        data: { reserved: { increment: quantity } }
      })
    ])

    const response = {
      id: reservation.id,
      productId: reservation.productId,
      productName: reservation.product.name,
      warehouseId: reservation.warehouseId,
      warehouseName: reservation.warehouse.name,
      quantity: reservation.quantity,
      status: reservation.status,
      expiresAt: reservation.expiresAt,
      createdAt: reservation.createdAt,
    }

    if (idempotencyKey) {
      await redis.set(`idempotency:${idempotencyKey}`, JSON.stringify(response), 'EX', 86400)
    }

    return NextResponse.json(response, { status: 201 })
  } finally {
    // Release lock only if we still own it
    const current = await redis.get(lockKey)
    if (current === lockValue) {
      await redis.del(lockKey)
    }
  }
}
