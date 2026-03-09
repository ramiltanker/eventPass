export class MeResponseDto {
  id!: string;
  email!: string;
  firstName!: string;
  lastName!: string;
  middleName!: string | null;
  role!: string;
  createdAt!: Date;
  updatedAt!: Date;
}
