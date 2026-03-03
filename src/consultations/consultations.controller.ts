import { Body, Controller, Post } from "@nestjs/common";
import { ConsultationsService } from "./consultations.service";
import { CreateConsultationDto } from "./dto/create-consultation.dto";

@Controller("consultations")
export class ConsultationsController {
  constructor(private readonly service: ConsultationsService) {}

  @Post()
  create(@Body() dto: CreateConsultationDto) {
    return this.service.create(dto);
  }
}