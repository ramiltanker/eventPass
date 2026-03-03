import { IsString, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  lastName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  middleName!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
