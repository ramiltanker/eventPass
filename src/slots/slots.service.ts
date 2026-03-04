import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BookSlotDto } from './dto/book-slot.dto';
import { Prisma } from '../../prisma/generated/prisma/client';

@Injectable()
export class SlotsService {
  constructor(private prisma: PrismaService) {}

  async book(slotId: number, dto: BookSlotDto) {
    if (!Number.isInteger(slotId) || slotId <= 0) {
      throw new BadRequestException('Invalid slotId');
    }

    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        isBooked: true,
        startsAt: true,
        consultationId: true,
        consultation: { select: { subject: true } },
      },
    });

    if (!slot) throw new NotFoundException('Slot not found');

    if (slot.startsAt <= new Date()) {
      throw new BadRequestException('Slot is in the past');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.slot.findUnique({
          where: { id: slotId },
          select: { isBooked: true },
        });
        if (!fresh) throw new NotFoundException('Slot not found');
        if (fresh.isBooked) throw new BadRequestException('Slot already booked');

        const booking = await tx.booking.create({
          data: {
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            middleName: dto.middleName?.trim() || null,
            email: dto.email.trim().toLowerCase(),
            group: dto.group.trim(),
            slotId,
          },
          select: { id: true },
        });

        await tx.slot.update({
          where: { id: slotId },
          data: { isBooked: true },
          select: { id: true },
        });

        return booking;
      });

      return {
        ok: true,
        bookingId: result.id,
        slotId: slot.id,
        consultationId: slot.consultationId,
        subject: slot.consultation.subject,
        startsAt: slot.startsAt,
      };
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Slot already booked');
      }
      throw e;
    }
  }
}