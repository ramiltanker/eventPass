import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
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

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('invites')
  async createInvite(
    @Headers('x-admin-secret') adminSecret: string | undefined,
    @Body() dto: CreateInviteDto,
  ) {
    this.auth.assertAdminSecret(adminSecret);

    const { token, expiresAt } = await this.auth.createInvite(
      dto.email,
      dto.expiresInDays ?? 7,
    );

    // В MVP вернём ссылку (потом отправим email)
    return {
      inviteUrl: `http://localhost:3001/invite/${token}`,
      expiresAt,
    };
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

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }
}
