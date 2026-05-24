import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const idempotencyKey = req.headers.get('Idempotency-Key')

  if (idempotencyKey) {
    const cached = await redis.get(`idempotency:confirm:${idempotencyKey}`)
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: { 'X-Idempotent-Replayed': 'true' }
      })
    }
  }

  const reservation = await prisma.reservation.findUnique({ where: { id } })

  if (!reservation) {
    return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
  }

  if (reservation.status !== 'PENDING') {
    return NextResponse.json({ error: `Reservation is already ${reservation.status}` }, { status: 400 })
  }

  if (new Date() > reservation.expiresAt) {
    // Lazy cleanup
    await prisma.$transaction([
      prisma.reservation.update({ where: { id }, data: { status: 'RELEASED' } }),
      prisma.stock.update({
        where: { productId_warehouseId: { productId: reservation.productId, warehouseId: reservation.warehouseId } },
        data: { reserved: { decrement: reservation.quantity } }
      })
    ])
    return NextResponse.json({ error: 'Reservation has expired' }, { status: 410 })
  }

  const [updated] = await prisma.$transaction([
    prisma.reservation.update({ where: { id }, data: { status: 'CONFIRMED' } }),
    prisma.stock.update({
      where: { productId_warehouseId: { productId: reservation.productId, warehouseId: reservation.warehouseId } },
      data: {
        total: { decrement: reservation.quantity },
        reserved: { decrement: reservation.quantity }
      }
    })
  ])

  const response = { id, status: 'CONFIRMED' }

  if (idempotencyKey) {
    await redis.set(`idempotency:confirm:${idempotencyKey}`, JSON.stringify(response), 'EX', 86400)
  }

  return NextResponse.json(response)
}
