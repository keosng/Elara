//Module = 启动时的装配说明书 + 功能边界 启动之后告诉大家各位是谁 都干嘛的

import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UsageModule } from '../usage/usage.module';
import { SessionAuthGuard } from '../auth/session-auth.guard';

@Module({
  //这个部门需要其他哪些部门
  imports: [PrismaModule, UsageModule],
  //这个部门对外接收哪些请求
  controllers: [ChatController],
  //这个部门内部有哪些可注入的工作人员
  providers: [ChatService, SessionAuthGuard],
})
export class ChatModule {}
