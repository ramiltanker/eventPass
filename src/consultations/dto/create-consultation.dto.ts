import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateConsultationDto {
  @IsString()
  subject: string;

  @IsISO8601()
  startsAt: string;

  @IsISO8601()
  endsAt: string;

  @IsOptional()
  @IsBoolean()
  withoutIntervals?: boolean;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  slotDurationMinutes?: number;

  @IsString()
  meetingLink: string;

  @IsOptional()
  @IsString()
  description?: string;
}