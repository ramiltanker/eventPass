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
import {
  buildStoredConsultationLocation,
  parseConsultationLocation,
} from './consultation-location.util';

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
    const storedLocation = buildStoredConsultationLocation({
      isOnline: dto.isOnline,
      meetingLink: dto.meetingLink,
      audienceNumber: dto.audienceNumber,
    });

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
        meetingLink: storedLocation,
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
      const location = parseConsultationLocation(item.meetingLink);

      return {
        id: item.id,
        subject: item.subject,
        description: item.description,
        meetingLink: location.meetingLink,
        audienceNumber: location.audienceNumber,
        isOnline: location.isOnline,
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
        meetingLink: true,
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
      const location = parseConsultationLocation(item.meetingLink);

      return {
        id: item.id,
        subject: item.subject,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        teacherName,
        isOnline: location.isOnline,
        audienceNumber: location.audienceNumber,
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

    const recipients = await this.getConsultationRecipients(consultationId);
    const currentLocation = parseConsultationLocation(consultation.meetingLink);

    const nextSubject = dto.subject ?? consultation.subject;
    const nextDescription =
      dto.description !== undefined
        ? dto.description
        : (consultation.description ?? undefined);
    const nextIsOnline = dto.isOnline ?? currentLocation.isOnline;
    const nextStoredLocation = buildStoredConsultationLocation({
      isOnline: nextIsOnline,
      meetingLink: dto.meetingLink ?? currentLocation.meetingLink,
      audienceNumber: dto.audienceNumber ?? currentLocation.audienceNumber,
    });
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

    const changes = this.buildConsultationChanges({
      current: {
        subject: consultation.subject,
        description: consultation.description ?? null,
        startsAt: consultation.startsAt,
        endsAt: consultation.endsAt,
        withoutIntervals: consultation.withoutIntervals,
        slotDurationMinutes: consultation.slotDurationMinutes,
        meetingLink: consultation.meetingLink,
      },
      next: {
        subject: nextSubject,
        description: nextDescription ?? null,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        withoutIntervals: nextWithoutIntervals,
        slotDurationMinutes: schedule.slotDurationMinutes,
        meetingLink: nextStoredLocation,
      },
    });

    const needsSlotRebuild =
      consultation.withoutIntervals !== nextWithoutIntervals ||
      consultation.startsAt.getTime() !== schedule.startsAt.getTime() ||
      consultation.endsAt.getTime() !== schedule.endsAt.getTime() ||
      consultation.slotDurationMinutes !== schedule.slotDurationMinutes;

    const existingBookingsCount = await this.countAnyBookings(consultationId);

    if (existingBookingsCount > 0 && needsSlotRebuild) {
      throw new BadRequestException(
        'Нельзя менять дату, время, интервалы или формат консультации, если на нее уже есть записи',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (!needsSlotRebuild) {
        return tx.consultation.update({
          where: { id: consultationId },
          data: {
            subject: nextSubject,
            description: nextDescription,
            meetingLink: nextStoredLocation,
          },
          include: {
            teacher: {
              select: {
                firstName: true,
                lastName: true,
                middleName: true,
                email: true,
              },
            },
            slots: true,
          },
        });
      }

      await tx.slot.deleteMany({
        where: { consultationId },
      });

      return tx.consultation.update({
        where: { id: consultationId },
        data: {
          subject: nextSubject,
          description: nextDescription,
          meetingLink: nextStoredLocation,
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
        include: {
          teacher: {
            select: {
              firstName: true,
              lastName: true,
              middleName: true,
              email: true,
            },
          },
          slots: true,
        },
      });
    });

    let notificationsSent = 0;

    if (changes.length > 0 && recipients.length > 0) {
      const teacherFullName = this.formatTeacherName(updated.teacher);
      const updatedLocation = parseConsultationLocation(updated.meetingLink);

      const mailResults = await Promise.allSettled(
        recipients.map((recipient) =>
          this.mail.sendConsultationUpdated({
            to: recipient.email,
            studentName: this.buildFullName({
              firstName: recipient.firstName,
              lastName: recipient.lastName,
              middleName: recipient.middleName,
            }),
            subjectName: updated.subject,
            teacherFullName,
            startsAt: updated.startsAt,
            endsAt: updated.endsAt,
            isOnline: updatedLocation.isOnline,
            meetingLink: updatedLocation.meetingLink,
            audienceNumber: updatedLocation.audienceNumber,
            changes,
          }),
        ),
      );

      notificationsSent = mailResults.filter(
        (result) => result.status === 'fulfilled',
      ).length;
    }

    return {
      id: updated.id,
      slotsCreated: updated.slots.length,
      notificationsSent,
    };
  }

  async remove(consultationId: number, teacherId: string) {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      select: {
        id: true,
        teacherId: true,
        subject: true,
        startsAt: true,
        endsAt: true,
        meetingLink: true,
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

    if (consultation.teacherId !== teacherId) {
      throw new ForbiddenException(
        'You can manage only your own consultations',
      );
    }

    const recipients = await this.getConsultationRecipients(consultationId);
    const teacherFullName = this.formatTeacherName(consultation.teacher);
    const location = parseConsultationLocation(consultation.meetingLink);

    await this.prisma.consultation.delete({
      where: { id: consultationId },
    });

    let notificationsSent = 0;

    if (recipients.length > 0) {
      const results = await Promise.allSettled(
        recipients.map((recipient) =>
          this.mail.sendConsultationCancelled({
            to: recipient.email,
            studentName: this.buildFullName({
              firstName: recipient.firstName,
              lastName: recipient.lastName,
              middleName: recipient.middleName,
            }),
            subjectName: consultation.subject,
            teacherFullName,
            startsAt: consultation.startsAt,
            endsAt: consultation.endsAt,
            isOnline: location.isOnline,
            meetingLink: location.meetingLink,
            audienceNumber: location.audienceNumber,
          }),
        ),
      );

      notificationsSent = results.filter(
        (result) => result.status === 'fulfilled',
      ).length;
    }

    return {
      ok: true,
      id: consultationId,
      notificationsSent,
      notificationsTotal: recipients.length,
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
    const location = parseConsultationLocation(consultation.meetingLink);

    await this.mail.sendBookingConfirmation({
      to: bookingInput.email,
      subjectName: consultation.subject,
      teacherFullName,
      startsAt: consultation.startsAt,
      endsAt: consultation.endsAt,
      isOnline: location.isOnline,
      meetingLink: location.meetingLink,
      audienceNumber: location.audienceNumber,
    });

    return {
      ok: true,
      bookingId: result.id,
      slotId: null,
      consultationId: consultation.id,
      subject: consultation.subject,
      startsAt: consultation.startsAt,
      endsAt: consultation.endsAt,
      isOnline: location.isOnline,
      audienceNumber: location.audienceNumber,
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
        meetingLink: true,
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
    const location = parseConsultationLocation(consultation.meetingLink);

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
        isOnline: location.isOnline,
        audienceNumber: location.audienceNumber,
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
      isOnline: location.isOnline,
      audienceNumber: location.audienceNumber,
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

  private formatRuDateTime(value: Date) {
    const timeZone = process.env.MAIL_TIMEZONE || 'Europe/Moscow';

    return new Intl.DateTimeFormat('ru-RU', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(value);
  }

  private buildFullName(person: {
    firstName: string;
    lastName: string;
    middleName: string | null;
  }) {
    return [person.lastName, person.firstName, person.middleName]
      .filter((x) => !!x && String(x).trim().length > 0)
      .join(' ')
      .trim();
  }

  private async getConsultationRecipients(consultationId: number) {
    const [directBookings, slotBookings] = await Promise.all([
      this.prisma.booking.findMany({
        where: { consultationId },
        select: {
          email: true,
          firstName: true,
          lastName: true,
          middleName: true,
        },
      }),
      this.prisma.slot.findMany({
        where: {
          consultationId,
          booking: {
            isNot: null,
          },
        },
        select: {
          booking: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
              middleName: true,
            },
          },
        },
      }),
    ]);

    const recipients = new Map<
      string,
      {
        email: string;
        firstName: string;
        lastName: string;
        middleName: string | null;
      }
    >();

    for (const booking of directBookings) {
      const email = booking.email.trim().toLowerCase();

      if (!recipients.has(email)) {
        recipients.set(email, {
          email,
          firstName: booking.firstName,
          lastName: booking.lastName,
          middleName: booking.middleName,
        });
      }
    }

    for (const slot of slotBookings) {
      if (!slot.booking) {
        continue;
      }

      const email = slot.booking.email.trim().toLowerCase();

      if (!recipients.has(email)) {
        recipients.set(email, {
          email,
          firstName: slot.booking.firstName,
          lastName: slot.booking.lastName,
          middleName: slot.booking.middleName,
        });
      }
    }

    return Array.from(recipients.values());
  }

  private buildConsultationChanges(params: {
    current: {
      subject: string;
      description: string | null;
      startsAt: Date;
      endsAt: Date;
      withoutIntervals: boolean;
      slotDurationMinutes: number | null;
      meetingLink: string;
    };
    next: {
      subject: string;
      description: string | null;
      startsAt: Date;
      endsAt: Date;
      withoutIntervals: boolean;
      slotDurationMinutes: number | null;
      meetingLink: string;
    };
  }) {
    const changes: string[] = [];

    const currentLocation = parseConsultationLocation(
      params.current.meetingLink,
    );
    const nextLocation = parseConsultationLocation(params.next.meetingLink);

    if (params.current.subject !== params.next.subject) {
      changes.push(
        `Предмет: «${params.current.subject}» → «${params.next.subject}»`,
      );
    }

    if (
      (params.current.description ?? '') !== (params.next.description ?? '')
    ) {
      changes.push('Описание консультации было изменено.');
    }

    if (params.current.startsAt.getTime() !== params.next.startsAt.getTime()) {
      changes.push(
        `Время начала: ${this.formatRuDateTime(params.current.startsAt)} → ${this.formatRuDateTime(params.next.startsAt)}`,
      );
    }

    if (params.current.endsAt.getTime() !== params.next.endsAt.getTime()) {
      changes.push(
        `Время окончания: ${this.formatRuDateTime(params.current.endsAt)} → ${this.formatRuDateTime(params.next.endsAt)}`,
      );
    }

    if (params.current.withoutIntervals !== params.next.withoutIntervals) {
      changes.push(
        params.next.withoutIntervals
          ? 'Консультация переведена в формат без выбора интервалов.'
          : 'Консультация переведена в формат с выбором временных интервалов.',
      );
    }

    if (
      params.current.slotDurationMinutes !== params.next.slotDurationMinutes
    ) {
      changes.push(
        `Длительность интервала: ${params.current.slotDurationMinutes ?? '—'} мин. → ${params.next.slotDurationMinutes ?? '—'} мин.`,
      );
    }

    if (currentLocation.isOnline !== nextLocation.isOnline) {
      changes.push(
        nextLocation.isOnline
          ? 'Формат консультации изменен: теперь онлайн.'
          : 'Формат консультации изменен: теперь очно.',
      );
    }

    if (
      currentLocation.isOnline &&
      nextLocation.isOnline &&
      (currentLocation.meetingLink ?? '') !== (nextLocation.meetingLink ?? '')
    ) {
      changes.push(
        `Ссылка на консультацию: ${currentLocation.meetingLink ?? '—'} → ${nextLocation.meetingLink ?? '—'}`,
      );
    }

    if (
      !currentLocation.isOnline &&
      !nextLocation.isOnline &&
      (currentLocation.audienceNumber ?? '') !==
        (nextLocation.audienceNumber ?? '')
    ) {
      changes.push(
        `Аудитория: ${currentLocation.audienceNumber ?? '—'} → ${nextLocation.audienceNumber ?? '—'}`,
      );
    }

    return changes;
  }
}
