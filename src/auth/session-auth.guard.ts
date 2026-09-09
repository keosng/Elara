import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/** 从 HttpOnly Session Cookie 读取登录用户，阻止未登录请求访问业务接口。 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  /**
   * 调用时机：NestJS 在进入标记了 @UseGuards 的 Controller 方法前自动调用。
   * 调用关系：请求 Cookie → express-session 读取 Session → 本方法检查 session.userId →
   * true 允许进入 Controller；没有 userId 则抛 UnauthorizedException，Controller 和 Service 都不会执行。
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.session?.userId) {
      throw new UnauthorizedException('请先登录');
    }

    return true;
  }
}
