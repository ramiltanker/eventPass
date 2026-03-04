import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';

@Injectable()
export class ConsultationsService {
  constructor(private prisma: PrismaService) {}

  async create(teacherId: string, dto: CreateConsultationDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (!teacherId || String(teacherId).trim().length === 0) {
      throw new BadRequestException('teacherId is required');
    }

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

    const slotMs = dto.slotDurationMinutes * 60 * 1000;
    const totalMs = endsAt.getTime() - startsAt.getTime();
    if (totalMs < slotMs) {
      throw new BadRequestException('Time range too small');
    }

    const slots: { startsAt: Date; endsAt: Date }[] = [];
    for (let t = startsAt.getTime(); t + slotMs <= endsAt.getTime(); t += slotMs) {
      slots.push({ startsAt: new Date(t), endsAt: new Date(t + slotMs) });
    }
    if (slots.length === 0) {
      throw new BadRequestException('No slots generated');
    }

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
          create: slots.map((s) => ({
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            isBooked: false,
          })),
        },
      },
      include: { slots: true },
    });

    return { id: created.id, slotsCreated: created.slots.length };
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

    if (items.length === 0) return [];

    const stats = await this.prisma.slot.groupBy({
      by: ['consultationId', 'isBooked'],
      where: {
        consultationId: { in: items.map((c) => c.id) },
      },
      _count: { _all: true },
    });

    const map = new Map<number, { total: number; booked: number }>();
    for (const row of stats) {
      const prev = map.get(row.consultationId) ?? { total: 0, booked: 0 };
      const count = row._count._all;

      prev.total += count;
      if (row.isBooked) prev.booked += count;

      map.set(row.consultationId, prev);
    }

    return items.map((c) => {
      const parts = [c.teacher.lastName, c.teacher.firstName, c.teacher.middleName].filter(
        (x) => !!x && String(x).trim().length > 0,
      );
      const teacherName = parts.length > 0 ? parts.join(' ') : c.teacher.email;

      const s = map.get(c.id) ?? { total: 0, booked: 0 };
      const slotsAvailable = Math.max(0, s.total - s.booked);

      return {
        id: c.id,
        subject: c.subject,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        teacherName,
        teacherAvatarUrl: null,

        slotsTotal: s.total,
        slotsBooked: s.booked,
        slotsAvailable,
      };
    });
  }

  // list slots by consultation
  async listSlots(consultationId: number) {
    if (!Number.isInteger(consultationId) || consultationId <= 0) {
      throw new BadRequestException('Invalid consultationId');
    }

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
        isBooked: true,
      },
    });

    return slots;
  }
}