import { NestFactory } from '@nestjs/core';
import * as argon2 from 'argon2';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from 'prisma/generated/prisma/enums';

async function bootstrap() {
  const [, , emailArg, passwordArg, firstNameArg, lastNameArg] = process.argv;

  const email = emailArg?.trim().toLowerCase();
  const password = passwordArg;
  const firstName = firstNameArg?.trim() || 'Admin';
  const lastName = lastNameArg?.trim() || 'User';

  if (!email || !password) {
    throw new Error(
      'Usage: npm run create:admin -- <email> <password> [firstName] [lastName]',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  try {
    const passwordHash = await argon2.hash(password);

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        passwordHash,
        firstName,
        lastName,
        role: UserRole.ADMIN,
      },
      create: {
        email,
        firstName,
        lastName,
        middleName: null,
        passwordHash,
        role: UserRole.ADMIN,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });

    console.log('Admin user is ready:');
    console.log(user);
  } finally {
    await app.close();
  }
}

void bootstrap();
