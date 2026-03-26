import { Body, Controller, Param, Post } from '@nestjs/common';
import { SlotsService } from './slots.service';
import { BookSlotDto } from './dto/book-slot.dto';

@Controller('slots')
export class SlotsController {
  constructor(private readonly service: SlotsService) {}

  @Post(':slotId/book')
  book(@Param('slotId') slotId: string, @Body() dto: BookSlotDto) {
    return this.service.book(Number(slotId), dto);
  }
}
