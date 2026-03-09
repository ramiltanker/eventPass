import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Patch,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  CurrentUser,
  CurrentUserType,
} from './decorators/current-user.decorator';
import { JwtAuthGuard } from './jwt/jwt-auth.guard';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { ListInvitesQueryDto } from './dto/list-invites-query.dto';
import { UserRole } from 'prisma/generated/prisma/enums';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Post('invites')
  async createInvite(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateInviteDto,
  ) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only ADMIN can create invites');
    }

    return this.auth.createInvite(dto.email, dto.expiresInDays ?? 7);
  }

  @UseGuards(JwtAuthGuard)
  @Get('invites')
  async getInvites(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListInvitesQueryDto,
  ) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only ADMIN can view invites');
    }

    return this.auth.getInvites(query.status ?? 'all');
  }

  @UseGuards(JwtAuthGuard)
  @Post('invites/:id/revoke')
  async revokeInvite(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only ADMIN can revoke invites');
    }

    return this.auth.revokeInvite(id);
  }

  @Post('validate-invite')
  async validateInvite(@Body() body: { token: string }) {
    return this.auth.validateInvite(body.token);
  }

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.auth.registerByInvite(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: CurrentUserType) {
    return this.auth.me(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateMeDto,
  ) {
    return this.auth.updateMe(user.userId, dto);
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }
}
