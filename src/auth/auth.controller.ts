import { Controller, Post, Body, Res, HttpStatus, Get, UseGuards, Req } from '@nestjs/common';
import { Response, Request } from 'express';

interface AuthenticatedRequest extends Request {
  user?: any;
}
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { UserService } from './user.service';
import { debugLog } from 'src/common/debug-logger';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  @Post('verify')
  async verifyToken(@Body() body: { token: string; refreshToken?: string }, @Res() res: Response) {
    try {
      const { token, refreshToken } = body || {};
      
      if (!token) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'Token is required',
        });
      }
      
      const decodedToken = await this.authService.verifyIdToken(token);
      
      // Create or update user in database
      const user = await this.userService.findOrCreateUser(decodedToken);
      
      // Set both ID token and refresh token cookies
      res.cookie('authToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 2592000000, // 30 days (30 * 24 * 60 * 60 * 1000)
      });

      if (refreshToken) {
        res.cookie('refreshToken', refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: 2592000000, // 30 days (30 * 24 * 60 * 60 * 1000)
        });
      }

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
      console.error('Token verification failed:', error);
      debugLog('Sending error response');
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Invalid token',
      });
    }
  }

  @Post('refresh')
  async refreshToken(@Body('refreshToken') refreshToken: string, @Res() res: Response) {
    debugLog('Refresh token endpoint called');
    
    if (!refreshToken) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Refresh token is required',
      });
    }
    
    try {
      const newTokens = await this.authService.refreshIdToken(refreshToken);
      
      // Update cookies with new tokens
      res.cookie('authToken', newTokens.idToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 2592000000, // 30 days
      });

      res.cookie('refreshToken', newTokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 2592000000, // 30 days
      });

      return res.status(HttpStatus.OK).json({
        success: true,
        message: 'Token refreshed successfully',
      });
    } catch (error) {
      console.error('Token refresh failed:', error);
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Failed to refresh token',
      });
    }
  }

  @Post('logout')
  logout(@Res() res: Response) {
    res.clearCookie('authToken');
    res.clearCookie('refreshToken');
    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Logged out successfully',
    });
  }

  @Get('config')
  getFirebaseConfig() {
    const config = {
      apiKey: process.env.FIREBASE_API_KEY || '',
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
      projectId: process.env.FIREBASE_PROJECT_ID || '',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.FIREBASE_APP_ID || ''
    };
    
    debugLog('Firebase config being returned:', {
      apiKey: config.apiKey ? 'SET' : 'MISSING',
      authDomain: config.authDomain ? 'SET' : 'MISSING',
      projectId: config.projectId ? 'SET' : 'MISSING',
      storageBucket: config.storageBucket ? 'SET' : 'MISSING',
      messagingSenderId: config.messagingSenderId ? 'SET' : 'MISSING',
      appId: config.appId ? 'SET' : 'MISSING'
    });
    
    debugLog('Actual projectId value:', config.projectId);
    
    // Check if critical env vars are missing
    if (!config.apiKey || !config.authDomain || !config.projectId) {
      console.error('Critical Firebase environment variables are missing');
      throw new Error('Firebase configuration incomplete');
    }
    
    return config;
  }

  @Get('login')
  async getLoginPage(@Res() res: Response) {
    const loginHtml = `
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - ArXiv Learning Tool</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.10/dist/full.min.css" rel="stylesheet" type="text/css" />
</head>
<body class="min-h-screen bg-base-200 flex items-center justify-center">
    <div class="card w-96 bg-base-100 shadow-xl">
        <div class="card-body">
            <h2 class="card-title justify-center mb-6">Sign in to ArXiv Learning Tool</h2>
            
            <form id="login-form" class="space-y-4">
                <div class="form-control">
                    <label class="label">
                        <span class="label-text">Email</span>
                    </label>
                    <input type="email" id="email" placeholder="Enter your email" class="input input-bordered w-full" required />
                </div>
                
                <div class="form-control">
                    <label class="label">
                        <span class="label-text">Password</span>
                    </label>
                    <input type="password" id="password" placeholder="Enter your password" class="input input-bordered w-full" required />
                </div>
                
                <button type="submit" class="btn btn-primary w-full">Sign In</button>
            </form>
            
            <div class="divider">New to the platform?</div>
            
            <form id="register-form" class="space-y-4" style="display: none;">
                <div class="form-control">
                    <label class="label">
                        <span class="label-text">Email</span>
                    </label>
                    <input type="email" id="reg-email" placeholder="Enter your email" class="input input-bordered w-full" required />
                </div>
                
                <div class="form-control">
                    <label class="label">
                        <span class="label-text">Password</span>
                    </label>
                    <input type="password" id="reg-password" placeholder="Enter your password" class="input input-bordered w-full" required />
                </div>
                
                <button type="submit" class="btn btn-primary w-full">Create Account</button>
            </form>
            
            <button id="toggle-form" class="btn btn-ghost w-full">Create Account</button>
        </div>
    </div>

    <script type="module">
        import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
        import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

        // Get Firebase config
        const configResponse = await fetch('/auth/config');
        const firebaseConfig = await configResponse.json();
        
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);

        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        const toggleButton = document.getElementById('toggle-form');
        let isLoginMode = true;

        toggleButton.addEventListener('click', () => {
            isLoginMode = !isLoginMode;
            if (isLoginMode) {
                loginForm.style.display = 'block';
                registerForm.style.display = 'none';
                toggleButton.textContent = 'Create Account';
            } else {
                loginForm.style.display = 'none';
                registerForm.style.display = 'block';
                toggleButton.textContent = 'Back to Sign In';
            }
        });

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            try {
                const result = await signInWithEmailAndPassword(auth, email, password);
                const idToken = await result.user.getIdToken();
                const refreshToken = result.user.refreshToken;
                
                console.log('Login successful, tokens obtained:', {
                    hasIdToken: !!idToken,
                    hasRefreshToken: !!refreshToken,
                    idTokenLength: idToken?.length,
                    refreshTokenLength: refreshToken?.length
                });
                
                const response = await fetch('/auth/verify', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        token: idToken,
                        refreshToken: refreshToken || undefined 
                    }),
                });

                if (response.ok) {
                    window.location.href = '/';
                } else {
                    const errorText = await response.text();
                    console.error('Authentication failed:', response.status, errorText);
                    alert('Authentication failed: ' + errorText);
                }
            } catch (error) {
                console.error('Error during sign-in:', error);
                alert('Sign-in failed: ' + error.message);
            }
        });

        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;
            
            try {
                const result = await createUserWithEmailAndPassword(auth, email, password);
                const idToken = await result.user.getIdToken();
                const refreshToken = result.user.refreshToken;
                
                console.log('Registration successful, tokens obtained:', {
                    hasIdToken: !!idToken,
                    hasRefreshToken: !!refreshToken,
                    idTokenLength: idToken?.length,
                    refreshTokenLength: refreshToken?.length
                });
                
                const response = await fetch('/auth/verify', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        token: idToken,
                        refreshToken: refreshToken || undefined 
                    }),
                });

                if (response.ok) {
                    window.location.href = '/';
                } else {
                    const errorText = await response.text();
                    console.error('Authentication failed:', response.status, errorText);
                    alert('Authentication failed: ' + errorText);
                }
            } catch (error) {
                console.error('Error during registration:', error);
                alert('Registration failed: ' + error.message);
            }
        });
    </script>
</body>
</html>`;
    
    res.send(loginHtml);
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