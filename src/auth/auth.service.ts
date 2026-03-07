import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { generateInviteToken, hashToken } from './invite-token.util';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private signAccessToken(userId: string) {
    return this.jwt.sign({ sub: userId, role: 'TEACHER' }, { expiresIn: '7d' });
  }

  async createInvite(email: string, expiresInDays = 7) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) throw new ConflictException('User already exists');

    const token = generateInviteToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(
      Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    );

    await this.prisma.teacherInvite.upsert({
      where: { email },
      update: { tokenHash, expiresAt, usedAt: null },
      create: { email, tokenHash, expiresAt },
    });

    return { token, expiresAt };
  }

  async validateInvite(token: string) {
    const tokenHash = hashToken(token);
    const invite = await this.prisma.teacherInvite.findFirst({
      where: { tokenHash },
      select: { email: true, expiresAt: true, usedAt: true },
    });

    if (!invite) return { valid: false as const };
    if (invite.usedAt) return { valid: false as const };
    if (invite.expiresAt.getTime() < Date.now())
      return { valid: false as const };

    return { valid: true as const, email: invite.email };
  }

  async registerByInvite(dto: {
    token: string;
    firstName: string;
    lastName: string;
    middleName?: string;
    password: string;
  }) {
    const tokenHash = hashToken(dto.token);

    const invite = await this.prisma.teacherInvite.findFirst({
      where: { tokenHash },
    });
    if (!invite) throw new BadRequestException('Invalid invite');
    if (invite.usedAt) throw new BadRequestException('Invite already used');
    if (invite.expiresAt.getTime() < Date.now())
      throw new BadRequestException('Invite expired');

    const email = invite.email;

    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('User already exists');

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          middleName: dto.middleName ?? '',
          passwordHash,
          role: 'TEACHER',
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          middleName: true,
          role: true,
        },
      });

      await tx.teacherInvite.update({
        where: { email },
        data: { usedAt: new Date() },
      });

      return created;
    });

    return { user, accessToken: this.signAccessToken(user.id) };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        middleName: user.middleName ?? '',
        role: user.role,
      },
      accessToken: this.signAccessToken(user.id),
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        middleName: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) throw new NotFoundException('Пользователь не найден');

    return user;
  }

  // простой “админ-чек” для MVP (позже заменим на нормальную админ-роль)
  assertAdminSecret(secret: string | undefined) {
    if (!secret || secret !== process.env.ADMIN_INVITE_SECRET) {
      throw new ForbiddenException('Forbidden');
    }
  }
}
