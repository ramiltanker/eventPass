import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import {
  CurrentUser,
  CurrentUserType,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt/jwt-auth.guard';

@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly service: ConsultationsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateConsultationDto) {
    if (!user?.userId) {
      throw new ForbiddenException('Unauthorized');
    }
    if (user.role !== 'TEACHER') {
      throw new ForbiddenException('Only TEACHER can create consultations');
    }

    return this.service.create(user.userId, dto);
  }

  @Get()
  listOpen() {
    return this.service.listOpen();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getById(Number(id));
  }

  @Get(':id/slots')
  listSlots(@Param('id') id: string) {
    return this.service.listSlots(Number(id));
  }
}