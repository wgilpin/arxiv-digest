import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Response } from 'express';

interface AuthenticatedRequest {
  user?: any;
  cookies?: any;
  headers?: any;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const token = this.extractTokenFromCookie(request) || this.extractTokenFromHeader(request);

    if (!token) {
      response.redirect('/auth/login');
      throw new UnauthorizedException('Redirecting to login');
    }

    try {
      const decodedToken = await this.authService.verifyIdToken(token);
      request.user = decodedToken;
      return true;
    } catch (error) {
      console.log("Auth: decode token error", error)
      response.redirect('/auth/login');
      throw new UnauthorizedException('Redirecting to login');
    }
  }

  private extractTokenFromCookie(request: any): string | undefined {
    return request.cookies?.authToken;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}