import { IsIn, IsOptional } from 'class-validator';

export class ListInvitesQueryDto {
  @IsOptional()
  @IsIn(['all', 'active', 'used', 'expired'])
  status?: 'all' | 'active' | 'used' | 'expired';
}
