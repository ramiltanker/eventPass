import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';
import { BookSlotDto } from '../slots/dto/book-slot.dto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class ConsultationsService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  private validateConsultationId(consultationId: number) {
    if (!Number.isInteger(consultationId) || consultationId <= 0) {
      throw new BadRequestException('Invalid consultationId');
    }
  }

  private formatTeacherName(teacher: {
    firstName: string;
    lastName: string;
    middleName: string | null;
    email: string;
  }) {
    const parts = [
      teacher.lastName,
      teacher.firstName,
      teacher.middleName,
    ].filter((x) => !!x && String(x).trim().length > 0);

    return parts.length > 0 ? parts.join(' ') : teacher.email;
  }

  private normalizeBookingInput(dto: BookSlotDto) {
    return {
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      middleName: dto.middleName?.trim() || null,
      email: dto.email.trim().toLowerCase(),
      group: dto.group.trim(),
    };
  }

  private parseConsultationPeriod(startsAtInput: string, endsAtInput: string) {
    const startsAt = new Date(startsAtInput);
    const endsAt = new Date(endsAtInput);

    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Invalid startsAt');
    }

    if (Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('Invalid endsAt');
    }

    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    if (startsAt <= new Date()) {
      throw new BadRequestException('Consultation must start in the future');
    }

    return {
      startsAt,
      endsAt,
    };
  }

  private buildSlots(
    startsAtInput: string,
    endsAtInput: string,
    slotDurationMinutes: number,
  ) {
    const { startsAt, endsAt } = this.parseConsultationPeriod(
      startsAtInput,
      endsAtInput,
    );

    const slotMs = slotDurationMinutes * 60 * 1000;
    const totalMs = endsAt.getTime() - startsAt.getTime();

    if (totalMs < slotMs) {
      throw new BadRequestException('Time range too small');
    }

    const slots: { startsAt: Date; endsAt: Date }[] = [];

    for (
      let t = startsAt.getTime();
      t + slotMs <= endsAt.getTime();
      t += slotMs
    ) {
      slots.push({
        startsAt: new Date(t),
        endsAt: new Date(t + slotMs),
      });
    }

    if (slots.length === 0) {
      throw new BadRequestException('No slots generated');
    }

    return {
      startsAt,
      endsAt,
      slots,
    };
  }

  private async buildAvailabilityMap(consultationIds: number[]) {
    if (consultationIds.length === 0) {
      return new Map<
        number,
        {
          withoutIntervals: boolean;
          slotsTotal: number | null;
          slotsBooked: number;
          slotsAvailable: number | null;
        }
      >();
    }

    const [consultations, slots, directBookings] = await Promise.all([
      this.prisma.consultation.findMany({
        where: {
          id: { in: consultationIds },
        },
        select: {
          id: true,
          withoutIntervals: true,
        },
      }),
      this.prisma.slot.findMany({
        where: {
          consultationId: { in: consultationIds },
        },
        select: {
          consultationId: true,
          booking: {
            select: { id: true },
          },
        },
      }),
      this.prisma.booking.findMany({
        where: {
          consultationId: { in: consultationIds },
        },
        select: {
          consultationId: true,
        },
      }),
    ]);

    const slotStatsMap = new Map<number, { total: number; booked: number }>();

    for (const row of slots) {
      const prev = slotStatsMap.get(row.consultationId) ?? {
        total: 0,
        booked: 0,
      };

      prev.total += 1;

      if (row.booking) {
        prev.booked += 1;
      }

      slotStatsMap.set(row.consultationId, prev);
    }

    const directBookingCountMap = new Map<number, number>();

    for (const booking of directBookings) {
      if (typeof booking.consultationId !== 'number') {
        continue;
      }

      directBookingCountMap.set(
        booking.consultationId,
        (directBookingCountMap.get(booking.consultationId) ?? 0) + 1,
      );
    }

    const result = new Map<
      number,
      {
        withoutIntervals: boolean;
        slotsTotal: number | null;
        slotsBooked: number;
        slotsAvailable: number | null;
      }
    >();

    for (const consultation of consultations) {
      if (consultation.withoutIntervals) {
        result.set(consultation.id, {
          withoutIntervals: true,
          slotsTotal: null,
          slotsBooked: directBookingCountMap.get(consultation.id) ?? 0,
          slotsAvailable: null,
        });
        continue;
      }

      const stats = slotStatsMap.get(consultation.id) ?? {
        total: 0,
        booked: 0,
      };

      result.set(consultation.id, {
        withoutIntervals: false,
        slotsTotal: stats.total,
        slotsBooked: stats.booked,
        slotsAvailable: Math.max(0, stats.total - stats.booked),
      });
    }

    return result;
  }

  private async countAnyBookings(consultationId: number) {
    const [bookedSlotsCount, directBookingsCount] = await Promise.all([
      this.prisma.slot.count({
        where: {
          consultationId,
          booking: {
            isNot: null,
          },
        },
      }),
      this.prisma.booking.count({
        where: {
          consultationId,
        },
      }),
    ]);

    return bookedSlotsCount + directBookingsCount;
  }

  private async getOwnedConsultationOrThrow(
    consultationId: number,
    teacherId: string,
  ) {
    this.validateConsultationId(consultationId);

    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      select: {
        id: true,
        teacherId: true,
        subject: true,
        startsAt: true,
        endsAt: true,
        withoutIntervals: true,
        slotDurationMinutes: true,
        meetingLink: true,
        description: true,
      },
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    if (consultation.teacherId !== teacherId) {
      throw new ForbiddenException(
        'You can manage only your own consultations',
      );
    }

    return consultation;
  }

  async create(teacherId: string, dto: CreateConsultationDto) {
    if (!teacherId || String(teacherId).trim().length === 0) {
      throw new BadRequestException('teacherId is required');
    }

    const withoutIntervals = dto.withoutIntervals ?? false;

    const schedule = withoutIntervals
      ? {
          ...this.parseConsultationPeriod(dto.startsAt, dto.endsAt),
          slots: [] as { startsAt: Date; endsAt: Date }[],
          slotDurationMinutes: null as number | null,
        }
      : (() => {
          const slotDurationMinutes = dto.slotDurationMinutes;

          if (
            typeof slotDurationMinutes !== 'number' ||
            !Number.isInteger(slotDurationMinutes)
          ) {
            throw new BadRequestException('slotDurationMinutes is required');
          }

          const built = this.buildSlots(
            dto.startsAt,
            dto.endsAt,
            slotDurationMinutes,
          );

          return {
            ...built,
            slotDurationMinutes,
          };
        })();

    const created = await this.prisma.consultation.create({
      data: {
        subject: dto.subject,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        withoutIntervals,
        slotDurationMinutes: schedule.slotDurationMinutes,
        meetingLink: dto.meetingLink,
        description: dto.description,
        teacherId,
        slots: {
          create: schedule.slots.map((slot) => ({
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
          })),
        },
      },
      include: { slots: true },
    });

    return {
      id: created.id,
      slotsCreated: created.slots.length,
    };
  }

  async listMine(teacherId: string) {
    if (!teacherId || String(teacherId).trim().length === 0) {
      throw new BadRequestException('teacherId is required');
    }

    const items = await this.prisma.consultation.findMany({
      where: { teacherId },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        subject: true,
        description: true,
        meetingLink: true,
        withoutIntervals: true,
        slotDurationMinutes: true,
        startsAt: true,
        endsAt: true,
      },
    });

    if (items.length === 0) {
      return [];
    }

    const availabilityMap = await this.buildAvailabilityMap(
      items.map((item) => item.id),
    );

    return items.map((item) => {
      const availability = availabilityMap.get(item.id) ?? {
        withoutIntervals: item.withoutIntervals,
        slotsTotal: null,
        slotsBooked: 0,
        slotsAvailable: null,
      };

      return {
        id: item.id,
        subject: item.subject,
        description: item.description,
        meetingLink: item.meetingLink,
        withoutIntervals: item.withoutIntervals,
        slotDurationMinutes: item.slotDurationMinutes,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        slotsTotal: availability.slotsTotal,
        slotsBooked: availability.slotsBooked,
        slotsAvailable: availability.slotsAvailable,
      };
    });
  }

  async listOpen() {
    const now = new Date();

    const items = await this.prisma.consultation.findMany({
      where: {
        startsAt: { gte: now },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        subject: true,
        withoutIntervals: true,
        startsAt: true,
        endsAt: true,
        teacher: {
          select: {
            firstName: true,
            lastName: true,
            middleName: true,
            email: true,
          },
        },
      },
    });

    if (items.length === 0) {
      return [];
    }

    const availabilityMap = await this.buildAvailabilityMap(
      items.map((item) => item.id),
    );

    return items.map((item) => {
      const teacherName = this.formatTeacherName(item.teacher);
      const availability = availabilityMap.get(item.id) ?? {
        withoutIntervals: item.withoutIntervals,
        slotsTotal: null,
        slotsBooked: 0,
        slotsAvailable: null,
      };

      return {
        id: item.id,
        subject: item.subject,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        teacherName,
        withoutIntervals: item.withoutIntervals,
        slotsTotal: availability.slotsTotal,
        slotsBooked: availability.slotsBooked,
        slotsAvailable: availability.slotsAvailable,
      };
    });
  }

  async update(
    consultationId: number,
    teacherId: string,
    dto: UpdateConsultationDto,
  ) {
    const consultation = await this.getOwnedConsultationOrThrow(
      consultationId,
      teacherId,
    );

    if (consultation.startsAt <= new Date()) {
      throw new BadRequestException('Past consultations cannot be updated');
    }

    const bookingsCount = await this.countAnyBookings(consultationId);

    if (bookingsCount > 0) {
      throw new BadRequestException(
        'Consultation with bookings cannot be updated',
      );
    }

    const nextSubject = dto.subject ?? consultation.subject;
    const nextDescription =
      dto.description !== undefined
        ? dto.description
        : (consultation.description ?? undefined);
    const nextMeetingLink = dto.meetingLink ?? consultation.meetingLink;
    const nextWithoutIntervals =
      dto.withoutIntervals ?? consultation.withoutIntervals;

    const nextStartsAtInput =
      dto.startsAt ?? consultation.startsAt.toISOString();
    const nextEndsAtInput = dto.endsAt ?? consultation.endsAt.toISOString();

    const schedule = nextWithoutIntervals
      ? {
          ...this.parseConsultationPeriod(nextStartsAtInput, nextEndsAtInput),
          slots: [] as { startsAt: Date; endsAt: Date }[],
          slotDurationMinutes: null as number | null,
        }
      : (() => {
          const nextSlotDurationMinutes =
            dto.slotDurationMinutes ?? consultation.slotDurationMinutes;

          if (
            typeof nextSlotDurationMinutes !== 'number' ||
            !Number.isInteger(nextSlotDurationMinutes)
          ) {
            throw new BadRequestException('slotDurationMinutes is required');
          }

          const built = this.buildSlots(
            nextStartsAtInput,
            nextEndsAtInput,
            nextSlotDurationMinutes,
          );

          return {
            ...built,
            slotDurationMinutes: nextSlotDurationMinutes,
          };
        })();

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.slot.deleteMany({
        where: { consultationId },
      });

      return tx.consultation.update({
        where: { id: consultationId },
        data: {
          subject: nextSubject,
          description: nextDescription,
          meetingLink: nextMeetingLink,
          startsAt: schedule.startsAt,
          endsAt: schedule.endsAt,
          withoutIntervals: nextWithoutIntervals,
          slotDurationMinutes: schedule.slotDurationMinutes,
          slots: {
            create: schedule.slots.map((slot) => ({
              startsAt: slot.startsAt,
              endsAt: slot.endsAt,
            })),
          },
        },
        include: { slots: true },
      });
    });

    return {
      id: updated.id,
      slotsCreated: updated.slots.length,
    };
  }

  async remove(consultationId: number, teacherId: string) {
    const consultation = await this.getOwnedConsultationOrThrow(
      consultationId,
      teacherId,
    );

    if (consultation.startsAt <= new Date()) {
      throw new BadRequestException('Past consultations cannot be deleted');
    }

    const bookingsCount = await this.countAnyBookings(consultationId);

    if (bookingsCount > 0) {
      throw new BadRequestException(
        'Consultation with bookings cannot be deleted',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.slot.deleteMany({
        where: { consultationId },
      });

      await tx.consultation.delete({
        where: { id: consultationId },
      });
    });

    return {
      ok: true,
      id: consultationId,
    };
  }

  async bookWithoutIntervals(consultationId: number, dto: BookSlotDto) {
    this.validateConsultationId(consultationId);

    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      select: {
        id: true,
        subject: true,
        startsAt: true,
        endsAt: true,
        withoutIntervals: true,
        meetingLink: true,
        teacher: {
          select: {
            firstName: true,
            lastName: true,
            middleName: true,
          },
        },
      },
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    if (!consultation.withoutIntervals) {
      throw new BadRequestException(
        'This consultation requires selecting a time slot',
      );
    }

    if (consultation.startsAt <= new Date()) {
      throw new BadRequestException('Consultation is no longer available');
    }

    const bookingInput = this.normalizeBookingInput(dto);

    const result = await this.prisma.booking.create({
      data: {
        ...bookingInput,
        consultationId,
      },
      select: { id: true },
    });

    const t = consultation.teacher;
    const teacherFullName = [t.lastName, t.firstName, t.middleName]
      .filter((x) => !!x && String(x).trim().length > 0)
      .join(' ')
      .trim();

    await this.mail.sendBookingConfirmation({
      to: bookingInput.email,
      subjectName: consultation.subject,
      teacherFullName,
      startsAt: consultation.startsAt,
      endsAt: consultation.endsAt,
      meetingLink: consultation.meetingLink,
    });

    return {
      ok: true,
      bookingId: result.id,
      slotId: null,
      consultationId: consultation.id,
      subject: consultation.subject,
      startsAt: consultation.startsAt,
      endsAt: consultation.endsAt,
    };
  }

  async getById(consultationId: number) {
    this.validateConsultationId(consultationId);

    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      select: {
        id: true,
        subject: true,
        description: true,
        startsAt: true,
        endsAt: true,
        withoutIntervals: true,
        teacher: {
          select: {
            firstName: true,
            lastName: true,
            middleName: true,
            email: true,
          },
        },
      },
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    if (consultation.startsAt < new Date()) {
      throw new BadRequestException('Consultation is no longer available');
    }

    const teacherName = this.formatTeacherName(consultation.teacher);

    if (consultation.withoutIntervals) {
      const bookingsCount = await this.prisma.booking.count({
        where: {
          consultationId,
        },
      });

      return {
        id: consultation.id,
        subject: consultation.subject,
        description: consultation.description,
        startsAt: consultation.startsAt,
        endsAt: consultation.endsAt,
        teacherName,
        withoutIntervals: true,
        slotsTotal: null,
        slotsBooked: bookingsCount,
        slotsAvailable: null,
      };
    }

    const slotsTotal = await this.prisma.slot.count({
      where: { consultationId },
    });

    const slotsBooked = await this.prisma.slot.count({
      where: {
        consultationId,
        booking: {
          isNot: null,
        },
      },
    });

    return {
      id: consultation.id,
      subject: consultation.subject,
      description: consultation.description,
      startsAt: consultation.startsAt,
      endsAt: consultation.endsAt,
      teacherName,
      withoutIntervals: false,
      slotsTotal,
      slotsBooked,
      slotsAvailable: Math.max(0, slotsTotal - slotsBooked),
    };
  }

  async listSlots(consultationId: number) {
    this.validateConsultationId(consultationId);

    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      select: { id: true, startsAt: true, withoutIntervals: true },
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    if (consultation.withoutIntervals) {
      return [];
    }

    if (consultation.startsAt < new Date()) {
      return [];
    }

    const slots = await this.prisma.slot.findMany({
      where: { consultationId },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        booking: {
          select: { id: true },
        },
      },
    });

    return slots.map((slot) => ({
      id: slot.id,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      isBooked: !!slot.booking,
    }));
  }
}