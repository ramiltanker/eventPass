import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaClient, UserRole } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

type TeacherSeed = {
  email: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  consultations: Array<{
    subject: string;
    dayOffset: number;
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
    slotDurationMinutes: number;
    description: string;
    meetingLink: string;
  }>;
};

const PASSWORD = 'DemoPass123!';

const teachers: TeacherSeed[] = [
  {
    email: 'danshina.mv@eventpass.demo',
    firstName: 'Марина',
    lastName: 'Даньшина',
    middleName: 'Владимировна',
    consultations: [
      {
        subject: 'Основы разработки мобильных приложений',
        dayOffset: 2,
        startHour: 10,
        startMinute: 0,
        endHour: 12,
        endMinute: 0,
        slotDurationMinutes: 20,
        description:
          'Консультация по архитектуре мобильных приложений, разбору практических задач и подготовке к занятиям.',
        meetingLink: 'https://meet.google.com/mobile-dev-demo',
      },
    ],
  },
  {
    email: 'britvina.vv@eventpass.demo',
    firstName: 'Валентина',
    lastName: 'Бритвина',
    middleName: 'Валентиновна',
    consultations: [
      {
        subject: 'Математические методы анализа данных',
        dayOffset: 4,
        startHour: 13,
        startMinute: 30,
        endHour: 15,
        endMinute: 30,
        slotDurationMinutes: 30,
        description:
          'Консультация по математическим методам анализа данных, работе с выборками и подготовке к контрольным заданиям.',
        meetingLink: 'https://meet.google.com/data-math-demo',
      },
      {
        subject: 'Вероятностные основы веб-аналитики',
        dayOffset: 6,
        startHour: 9,
        startMinute: 15,
        endHour: 11,
        endMinute: 15,
        slotDurationMinutes: 15,
        description:
          'Консультация по вероятностным моделям, метрикам веб-аналитики и разбору типовых задач.',
        meetingLink: 'https://meet.google.com/web-analytics-demo',
      },
    ],
  },
  {
    email: 'gavrilov.ai@eventpass.demo',
    firstName: 'Александр',
    lastName: 'Гаврилов',
    middleName: 'Игоревич',
    consultations: [
      {
        subject: 'Методы машинного обучения',
        dayOffset: 8,
        startHour: 16,
        startMinute: 45,
        endHour: 18,
        endMinute: 45,
        slotDurationMinutes: 45,
        description:
          'Консультация по базовым и прикладным методам машинного обучения, метрикам и обучающим экспериментам.',
        meetingLink: 'https://meet.google.com/ml-methods-demo',
      },
    ],
  },
];

const buildDate = (
  dayOffset: number,
  hours: number,
  minutes: number,
): Date => {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return date;
};

const buildSlots = (
  startsAt: Date,
  endsAt: Date,
  slotDurationMinutes: number,
) => {
  const slots: Array<{ startsAt: Date; endsAt: Date }> = [];
  const slotMs = slotDurationMinutes * 60 * 1000;

  let current = startsAt.getTime();
  const end = endsAt.getTime();

  while (current + slotMs <= end) {
    slots.push({
      startsAt: new Date(current),
      endsAt: new Date(current + slotMs),
    });

    current += slotMs;
  }

  return slots;
};

async function main() {
  const passwordHash = await argon2.hash(PASSWORD);

  for (const teacher of teachers) {
    await prisma.user.upsert({
      where: { email: teacher.email },
      update: {
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        middleName: teacher.middleName ?? null,
        passwordHash,
        role: UserRole.TEACHER,
      },
      create: {
        email: teacher.email,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        middleName: teacher.middleName ?? null,
        passwordHash,
        role: UserRole.TEACHER,
      },
    });
  }

  const demoEmails = teachers.map((teacher) => teacher.email);
  const demoUsers = await prisma.user.findMany({
    where: {
      email: {
        in: demoEmails,
      },
    },
    select: {
      id: true,
      email: true,
    },
  });

  const userIdByEmail = new Map(demoUsers.map((user) => [user.email, user.id]));

  for (const teacher of teachers) {
    const teacherId = userIdByEmail.get(teacher.email);

    if (!teacherId) {
      throw new Error(`Не найден пользователь для ${teacher.email}`);
    }

    const existingConsultations = await prisma.consultation.findMany({
      where: { teacherId },
      select: { id: true },
    });

    if (existingConsultations.length > 0) {
      const consultationIds = existingConsultations.map((item) => item.id);

      const existingSlots = await prisma.slot.findMany({
        where: {
          consultationId: {
            in: consultationIds,
          },
        },
        select: { id: true },
      });

      if (existingSlots.length > 0) {
        await prisma.booking.deleteMany({
          where: {
            slotId: {
              in: existingSlots.map((slot) => slot.id),
            },
          },
        });
      }

      await prisma.slot.deleteMany({
        where: {
          consultationId: {
            in: consultationIds,
          },
        },
      });

      await prisma.consultation.deleteMany({
        where: { teacherId },
      });
    }

    for (const consultation of teacher.consultations) {
      const startsAt = buildDate(
        consultation.dayOffset,
        consultation.startHour,
        consultation.startMinute,
      );

      const endsAt = buildDate(
        consultation.dayOffset,
        consultation.endHour,
        consultation.endMinute,
      );

      const createdConsultation = await prisma.consultation.create({
        data: {
          subject: consultation.subject,
          description: consultation.description,
          meetingLink: consultation.meetingLink,
          startsAt,
          endsAt,
          slotDurationMinutes: consultation.slotDurationMinutes,
          teacherId,
        },
      });

      const slots = buildSlots(
        startsAt,
        endsAt,
        consultation.slotDurationMinutes,
      );

      if (slots.length > 0) {
        await prisma.slot.createMany({
          data: slots.map((slot) => ({
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            consultationId: createdConsultation.id,
          })),
        });
      }
    }
  }

  console.log('Seed completed successfully.');
  console.log('Demo password for all teachers:', PASSWORD);
  console.log('Demo teachers:');
  for (const teacher of teachers) {
    console.log(`- ${teacher.email}`);
  }
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });