import { Controller, Post, Body, Res, HttpStatus, Get, UseGuards, Req } from '@nestjs/common';
import { Response, Request } from 'express';

interface AuthenticatedRequest extends Request {
  user?: any;
}
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { UserService } from './user.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  @Post('verify')
  async verifyToken(@Body('token') token: string, @Res() res: Response) {
    try {
      const decodedToken = await this.authService.verifyIdToken(token);
      
      // Create or update user in database
      const user = await this.userService.findOrCreateUser(decodedToken);
      
      res.cookie('authToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 3600000, // 1 hour
      });

      return res.status(HttpStatus.OK).json({
        success: true,
        user: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        },
      });
    } catch (error) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Invalid token',
      });
    }
  }

  @Post('logout')
  async logout(@Res() res: Response) {
    res.clearCookie('authToken');
    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Logged out successfully',
    });
  }

  @Get('config')
  getFirebaseConfig() {
    return {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID
    };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async getCurrentUser(@Req() req: AuthenticatedRequest) {
    return {
      success: true,
      user: req.user,
    };
  }
}