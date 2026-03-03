export class MeResponseDto {
  id!: string;
  email!: string;
  firstName!: string;
  lastName!: string;
  middleName!: string | null;
  role!: 'TEACHER';
  createdAt!: Date;
  updatedAt!: Date;
}
