import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let authService: jest.Mocked<AuthService>;
  let mockRequest: any;
  let mockResponse: any;
  let mockContext: ExecutionContext;

  beforeEach(async () => {
    const mockAuthService = {
      verifyIdToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthGuard,
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    guard = module.get<AuthGuard>(AuthGuard);
    authService = module.get(AuthService);

    // Setup mock request and response
    mockRequest = {
      cookies: {},
      headers: {},
    };

    mockResponse = {
      redirect: jest.fn(),
      headersSent: false,
    };

    mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as ExecutionContext;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('canActivate', () => {
    it('should redirect to login when no token is provided', async () => {
      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('should redirect to login when token is in cookie but invalid', async () => {
      mockRequest.cookies.authToken = 'invalid-token';
      authService.verifyIdToken.mockRejectedValue(new Error('Invalid token'));

      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('should redirect to login when token is in header but invalid', async () => {
      mockRequest.headers.authorization = 'Bearer invalid-token';
      authService.verifyIdToken.mockRejectedValue(new Error('Invalid token'));

      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('should allow access when valid token is in cookie', async () => {
      const mockDecodedToken = {
        uid: 'user123',
        email: 'test@example.com',
        aud: 'project-id',
        auth_time: 1234567890,
        exp: 1234567890,
        firebase: { identities: {}, sign_in_provider: 'password' },
        iat: 1234567890,
        iss: 'https://securetoken.google.com/project-id',
        sub: 'user123'
      } as any;
      mockRequest.cookies.authToken = 'valid-token';
      authService.verifyIdToken.mockResolvedValue(mockDecodedToken);

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(mockRequest.user).toEqual(mockDecodedToken);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should allow access when valid token is in header', async () => {
      const mockDecodedToken = {
        uid: 'user123',
        email: 'test@example.com',
        aud: 'project-id',
        auth_time: 1234567890,
        exp: 1234567890,
        firebase: { identities: {}, sign_in_provider: 'password' },
        iat: 1234567890,
        iss: 'https://securetoken.google.com/project-id',
        sub: 'user123'
      } as any;
      mockRequest.headers.authorization = 'Bearer valid-token';
      authService.verifyIdToken.mockResolvedValue(mockDecodedToken);

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(mockRequest.user).toEqual(mockDecodedToken);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should prefer cookie token over header token', async () => {
      const mockDecodedToken = {
        uid: 'user123',
        email: 'test@example.com',
        aud: 'project-id',
        auth_time: 1234567890,
        exp: 1234567890,
        firebase: { identities: {}, sign_in_provider: 'password' },
        iat: 1234567890,
        iss: 'https://securetoken.google.com/project-id',
        sub: 'user123'
      } as any;
      mockRequest.cookies.authToken = 'cookie-token';
      mockRequest.headers.authorization = 'Bearer header-token';
      authService.verifyIdToken.mockResolvedValue(mockDecodedToken);

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(authService.verifyIdToken).toHaveBeenCalledWith('cookie-token');
      expect(authService.verifyIdToken).not.toHaveBeenCalledWith('header-token');
    });

    it('should handle malformed authorization header', async () => {
      mockRequest.headers.authorization = 'InvalidFormat';

      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('should handle empty authorization header', async () => {
      mockRequest.headers.authorization = '';

      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('should handle non-Bearer authorization header', async () => {
      mockRequest.headers.authorization = 'Basic some-token';

      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.redirect).toHaveBeenCalledWith('/auth/login');
    });
  });
});