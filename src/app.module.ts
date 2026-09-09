import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,

      validationSchema: Joi.object({
        API_KEY: Joi.string().min(1).required(),
        BASE_URL: Joi.string().uri().required(),
        MODEL: Joi.string().min(1).required(),
        DATABASE_URL: Joi.string().min(1).required(),
        DEV_USER_ID: Joi.string().min(1).optional(),
        SESSION_SECRET: Joi.string().min(32).optional(),

        // 认证功能还没实现，所以暂时不要求它
        JWT_SECRET: Joi.string().min(32).optional(),
      }),

      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),

    AuthModule,
    ChatModule,
  ],
})
export class AppModule {}
