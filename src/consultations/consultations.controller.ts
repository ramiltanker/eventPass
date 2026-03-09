import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';
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
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateConsultationDto,
  ) {
    if (!user?.userId) {
      throw new ForbiddenException('Unauthorized');
    }
    if (user.role !== 'TEACHER') {
      throw new ForbiddenException('Only TEACHER can create consultations');
    }

    return this.service.create(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my')
  listMine(@CurrentUser() user: CurrentUserType) {
    if (!user?.userId) {
      throw new ForbiddenException('Unauthorized');
    }
    if (user.role !== 'TEACHER') {
      throw new ForbiddenException('Only TEACHER can access own consultations');
    }

    return this.service.listMine(user.userId);
  }

  @Get()
  listOpen() {
    return this.service.listOpen();
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateConsultationDto,
  ) {
    if (!user?.userId) {
      throw new ForbiddenException('Unauthorized');
    }
    if (user.role !== 'TEACHER') {
      throw new ForbiddenException('Only TEACHER can update consultations');
    }

    return this.service.update(Number(id), user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    if (!user?.userId) {
      throw new ForbiddenException('Unauthorized');
    }
    if (user.role !== 'TEACHER') {
      throw new ForbiddenException('Only TEACHER can delete consultations');
    }

    return this.service.remove(Number(id), user.userId);
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
