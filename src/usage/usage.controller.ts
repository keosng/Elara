import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { UsageService } from './usage.service';

@Controller('api/usage')
@UseGuards(SessionAuthGuard)
export class UsageController {
  /**
   * NestJS 启动 UsageModule 时注入 UsageService；本类只处理 Token 用量查询的 HTTP 边界。
   */
  constructor(private readonly usageService: UsageService) {}

  @Get()
  /**
   * 调用链：前端打开页面或一轮对话完成 → GET /api/usage → SessionAuthGuard 校验 Cookie →
   * 本方法 → UsageService.getUsageOverview(userId) → 返回用户和会话 Token 汇总。
   * userId 只来自 Session，前端不能查询其他用户的用量。
   */
  getUsageOverview(@Req() request: Request) {
    return this.usageService.getUsageOverview(request.session.userId!);
  }
}
