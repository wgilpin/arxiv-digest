import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Response } from 'express';
import { debugLog } from 'src/common/debug-logger';

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
      debugLog("Auth: decode token error", error);
      
      // Try to refresh the token using refresh token from cookie
      const refreshToken = this.extractRefreshTokenFromCookie(request);
      if (refreshToken) {
        try {
          debugLog("Auth: attempting token refresh");
          const newTokens = await this.authService.refreshIdToken(refreshToken);
          
          // Update cookies with new tokens
          response.cookie('authToken', newTokens.idToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 2592000000, // 30 days
          });
          
          response.cookie('refreshToken', newTokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 2592000000, // 30 days
          });
          
          // Verify the new token and set user
          const decodedNewToken = await this.authService.verifyIdToken(newTokens.idToken);
          request.user = decodedNewToken;
          debugLog("Auth: token refresh successful");
          return true;
        } catch (refreshError) {
          debugLog("Auth: token refresh failed", refreshError);
        }
      }
      
      response.redirect('/auth/login');
      throw new UnauthorizedException('Redirecting to login');
    }
  }

  private extractTokenFromCookie(request: any): string | undefined {
    return request.cookies?.authToken;
  }

  private extractRefreshTokenFromCookie(request: any): string | undefined {
    return request.cookies?.refreshToken;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}