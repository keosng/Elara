import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { RegisterInput } from './auth.service';

// 此控制器中的接口统一以 /api/auth 开头。
@Controller('api/auth')
export class AuthController {
  // 控制器只接收请求，具体注册逻辑交给 AuthService。
  constructor(private readonly authService: AuthService) {}

  // POST /api/auth/register
  @Post('register')
  register(@Body() body: RegisterInput) {
    return this.authService.register(body);
  }
}
