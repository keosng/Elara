// UsageModule：负责 token 用量记录、查询接口和依赖装配。

import { Module } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsageController],
  providers: [UsageService, SessionAuthGuard],
  exports: [UsageService],
})
export class UsageModule {}
