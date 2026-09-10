// UsageModule：负责 token 用量记录的依赖装配，只导出 UsageService 供聊天模块使用。

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsageService } from './usage.service';

@Module({
  imports: [PrismaModule],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
