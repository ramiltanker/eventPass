import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class BookSlotDto {
  @IsString()
  @MaxLength(60)
  firstName: string;

  @IsString()
  @MaxLength(60)
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  middleName?: string;

  @IsEmail()
  @MaxLength(120)
  email: string;

  @IsString()
  @MaxLength(50)
  group: string;
}