import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BookSlotDto } from './dto/book-slot.dto';
import { Prisma } from '../../prisma/generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { parseConsultationLocation } from '../consultations/consultation-location.util';

@Injectable()
export class SlotsService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async book(slotId: number, dto: BookSlotDto) {
    if (!Number.isInteger(slotId) || slotId <= 0) {
      throw new BadRequestException('Invalid slotId');
    }

    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        consultationId: true,
        consultation: {
          select: {
            subject: true,
            meetingLink: true,
            teacher: {
              select: {
                firstName: true,
                lastName: true,
                middleName: true,
              },
            },
          },
        },
      },
    });

    if (!slot) {
      throw new NotFoundException('Slot not found');
    }

    if (slot.startsAt <= new Date()) {
      throw new BadRequestException('Slot is in the past');
    }

    const studentEmail = dto.email.trim().toLowerCase();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.slot.findUnique({
          where: { id: slotId },
          select: {
            id: true,
            booking: {
              select: { id: true },
            },
          },
        });

        if (!fresh) {
          throw new NotFoundException('Slot not found');
        }

        if (fresh.booking) {
          throw new BadRequestException('Slot already booked');
        }

        const booking = await tx.booking.create({
          data: {
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            middleName: dto.middleName?.trim() || null,
            email: studentEmail,
            group: dto.group.trim(),
            slotId,
          },
          select: { id: true },
        });

        return booking;
      });

      const t = slot.consultation.teacher;
      const teacherFullName = [t.lastName, t.firstName, t.middleName]
        .filter((x) => !!x && String(x).trim().length > 0)
        .join(' ')
        .trim();
      const location = parseConsultationLocation(slot.consultation.meetingLink);

      await this.mail.sendBookingConfirmation({
        to: studentEmail,
        subjectName: slot.consultation.subject,
        teacherFullName,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        isOnline: location.isOnline,
        meetingLink: location.meetingLink,
        audienceNumber: location.audienceNumber,
      });

      return {
        ok: true,
        bookingId: result.id,
        slotId: slot.id,
        consultationId: slot.consultationId,
        subject: slot.consultation.subject,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        isOnline: location.isOnline,
        audienceNumber: location.audienceNumber,
      };
    } catch (e: unknown) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('Slot already booked');
      }
      throw e;
    }
  }
}
