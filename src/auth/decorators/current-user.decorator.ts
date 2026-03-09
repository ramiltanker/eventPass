import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from 'prisma/generated/prisma/enums';

export type CurrentUserType = {
  userId: string;
  role: UserRole;
};

type RequestWithUser = Request & {
  user: CurrentUserType;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserType => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    return req.user;
  },
);
