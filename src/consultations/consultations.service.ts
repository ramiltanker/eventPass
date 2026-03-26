import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';

@Injectable()
export class ConsultationsService {
  constructor(private prisma: PrismaService) {}

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

  private async buildSlotStatsMap(consultationIds: number[]) {
    if (consultationIds.length === 0) {
      return new Map<number, { total: number; booked: number }>();
    }

    const slots = await this.prisma.slot.findMany({
      where: {
        consultationId: { in: consultationIds },
      },
      select: {
        consultationId: true,
        booking: {
          select: { id: true },
        },
      },
    });

    const map = new Map<number, { total: number; booked: number }>();

    for (const row of slots) {
      const prev = map.get(row.consultationId) ?? { total: 0, booked: 0 };
      prev.total += 1;

      if (row.booking) {
        prev.booked += 1;
      }

      map.set(row.consultationId, prev);
    }

    return map;
  }

  private buildSlots(
    startsAtInput: string,
    endsAtInput: string,
    slotDurationMinutes: number,
  ) {
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

    const { startsAt, endsAt, slots } = this.buildSlots(
      dto.startsAt,
      dto.endsAt,
      dto.slotDurationMinutes,
    );

    const created = await this.prisma.consultation.create({
      data: {
        subject: dto.subject,
        startsAt,
        endsAt,
        slotDurationMinutes: dto.slotDurationMinutes,
        meetingLink: dto.meetingLink,
        description: dto.description,
        teacherId,
        slots: {
          create: slots.map((slot) => ({
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
        slotDurationMinutes: true,
        startsAt: true,
        endsAt: true,
      },
    });

    if (items.length === 0) {
      return [];
    }

    const statsMap = await this.buildSlotStatsMap(items.map((item) => item.id));

    return items.map((item) => {
      const stats = statsMap.get(item.id) ?? { total: 0, booked: 0 };

      return {
        id: item.id,
        subject: item.subject,
        description: item.description,
        meetingLink: item.meetingLink,
        slotDurationMinutes: item.slotDurationMinutes,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        slotsTotal: stats.total,
        slotsBooked: stats.booked,
        slotsAvailable: Math.max(0, stats.total - stats.booked),
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

    const statsMap = await this.buildSlotStatsMap(items.map((item) => item.id));

    return items.map((item) => {
      const teacherName = this.formatTeacherName(item.teacher);
      const stats = statsMap.get(item.id) ?? { total: 0, booked: 0 };

      return {
        id: item.id,
        subject: item.subject,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        teacherName,
        slotsTotal: stats.total,
        slotsBooked: stats.booked,
        slotsAvailable: Math.max(0, stats.total - stats.booked),
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

    const bookedSlotsCount = await this.prisma.slot.count({
      where: {
        consultationId,
        booking: {
          isNot: null,
        },
      },
    });

    if (bookedSlotsCount > 0) {
      throw new BadRequestException(
        'Consultation with booked slots cannot be updated',
      );
    }

    const nextSubject = dto.subject ?? consultation.subject;
    const nextDescription =
      dto.description !== undefined
        ? dto.description
        : (consultation.description ?? undefined);
    const nextMeetingLink = dto.meetingLink ?? consultation.meetingLink;
    const nextSlotDurationMinutes =
      dto.slotDurationMinutes ?? consultation.slotDurationMinutes;

    const nextStartsAtInput =
      dto.startsAt ?? consultation.startsAt.toISOString();
    const nextEndsAtInput = dto.endsAt ?? consultation.endsAt.toISOString();

    const { startsAt, endsAt, slots } = this.buildSlots(
      nextStartsAtInput,
      nextEndsAtInput,
      nextSlotDurationMinutes,
    );

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
          startsAt,
          endsAt,
          slotDurationMinutes: nextSlotDurationMinutes,
          slots: {
            create: slots.map((slot) => ({
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

    const bookedSlotsCount = await this.prisma.slot.count({
      where: {
        consultationId,
        booking: {
          isNot: null,
        },
      },
    });

    if (bookedSlotsCount > 0) {
      throw new BadRequestException(
        'Consultation with booked slots cannot be deleted',
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
      throw new BadRequestException('Consultation not found');
    }

    if (consultation.startsAt < new Date()) {
      throw new BadRequestException('Consultation is no longer available');
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

    const teacherName = this.formatTeacherName(consultation.teacher);

    return {
      id: consultation.id,
      subject: consultation.subject,
      description: consultation.description,
      startsAt: consultation.startsAt,
      endsAt: consultation.endsAt,
      teacherName,
      slotsTotal,
      slotsBooked,
      slotsAvailable: Math.max(0, slotsTotal - slotsBooked),
    };
  }

  async listSlots(consultationId: number) {
    this.validateConsultationId(consultationId);

    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      select: { id: true, startsAt: true },
    });

    if (!consultation) {
      throw new BadRequestException('Consultation not found');
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
