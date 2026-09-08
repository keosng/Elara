import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient  //继承PrismaClient里的方法
  implements OnModuleInit, OnModuleDestroy  //生命周期
{
  constructor() {  //构造函数
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });

    super({ adapter });
  }

  //开项目时
  async onModuleInit() {
    await this.$connect(); //项目启动时:连接 PostgreSQL PrismaClient里的方法
  }

  //关项目时
  async onModuleDestroy() {
    await this.$disconnect(); //项目关闭时：断开 PostgreSQL PrismaClient里的方法
  }
}