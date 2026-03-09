export class InviteResponseDto {
  id!: string;
  email!: string;
  expiresAt!: Date;
  usedAt!: Date | null;
  createdAt!: Date;
  status!: 'active' | 'used' | 'expired';
}
