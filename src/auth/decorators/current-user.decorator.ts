import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type CurrentUserType = { userId: string; role: 'TEACHER' };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserType => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as CurrentUserType;
  },
);
