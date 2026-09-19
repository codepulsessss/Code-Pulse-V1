import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { AuthenticatedUser } from './types/authenticated-user.type.js';

@Controller('/api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get('/me')
  me(@Request() req: { user: AuthenticatedUser }) {
    return this.authService.validateAndGetUser(req.user.userId);
  }
}
