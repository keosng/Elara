import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { RegisterInput } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: RegisterInput) {
    return this.authService.register(body);
  }
}
