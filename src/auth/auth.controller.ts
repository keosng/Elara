import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { LoginInput, RegisterInput } from './auth.service';
import { SessionAuthGuard } from './session-auth.guard';

// 此控制器中的接口统一以 /api/auth 开头。
@Controller('api/auth')
export class AuthController {
  // NestJS 启动时注入 AuthService；本类只负责把 HTTP 请求转换成业务方法调用。
  constructor(private readonly authService: AuthService) {}

  // POST /api/auth/register
  @Post('register')
  /**
   * 调用链：浏览器提交注册表单 → 本方法 → AuthService.register →
   * PrismaService.user.create → 返回不含 passwordHash 的公开用户资料。
   * 参数 body 来自 JSON 请求体；校验、密码摘要和重复邮箱处理由 Service 负责。
   */
  register(@Body() body: RegisterInput) {
    return this.authService.register(body);
  }

  // POST /api/auth/login
  @Post('login')
  /**
   * 调用链：浏览器提交邮箱密码 → AuthService.login 校验密码 →
   * request.session.regenerate 轮换旧 Session ID → 写入 request.session.userId →
   * express-session 调用 PrismaSessionStore.set 持久化 Session，并通过 Set-Cookie 返回 ID。
   * 登录失败会在 AuthService 抛出 UnauthorizedException，本方法不会创建登录态。
   */
  async login(@Body() body: LoginInput, @Req() request: Request) {
    const user = await this.authService.login(body);
    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    request.session.userId = user.id;
    return user;
  }

  // GET /api/auth/me
  @Get('me')
  @UseGuards(SessionAuthGuard)
  /**
   * 调用链：浏览器携带 HttpOnly Cookie → SessionAuthGuard 读取 userId →
   * 本方法 → AuthService.getPublicUser → User 表 → 返回当前用户资料。
   * Guard 已拒绝无效 Session；若用户已被删除，本方法返回“登录状态已失效”。
   */
  async me(@Req() request: Request) {
    const user = await this.authService.getPublicUser(request.session.userId!);
    if (!user) {
      throw new UnauthorizedException('登录状态已失效');
    }
    return user;
  }

  // POST /api/auth/logout
  @Post('logout')
  @UseGuards(SessionAuthGuard)
  /**
   * 调用链：浏览器点击退出 → SessionAuthGuard 校验登录 →
   * request.session.destroy → PrismaSessionStore.destroy 删除数据库 Session →
   * clearCookie 清除浏览器 Cookie → 返回 loggedOut=true。
   */
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return new Promise<{ loggedOut: boolean }>((resolve, reject) => {
      request.session.destroy((error) => {
        if (error) return reject(error);
        response.clearCookie('elara.sid');
        resolve({ loggedOut: true });
      });
    });
  }
}
