/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/await-thenable */
import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { HttpStatus } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserService } from './user.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;
  let userService: jest.Mocked<UserService>;
  let mockResponse: jest.Mocked<Response>;

  beforeEach(async () => {
    const mockAuthService = {
      verifyIdToken: jest.fn(),
    };

    const mockUserService = {
      findOrCreateUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
    userService = module.get(UserService);

    mockResponse = {
      cookie: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('verifyToken', () => {
    it('should verify valid token and create user', async () => {
      const token = 'valid-firebase-token';
      const decodedToken = {
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
      const user = { uid: 'user123', email: 'test@example.com', displayName: 'Test User', photoURL: undefined, createdAt: new Date() };

      authService.verifyIdToken.mockResolvedValue(decodedToken);
      userService.findOrCreateUser.mockResolvedValue(user);

      await controller.verifyToken({ token }, mockResponse);

      expect(authService.verifyIdToken).toHaveBeenCalledWith(token);
      expect(userService.findOrCreateUser).toHaveBeenCalledWith(decodedToken);
      expect(mockResponse.cookie).toHaveBeenCalledWith('authToken', token, {
        httpOnly: true,
        secure: false, // NODE_ENV !== 'production'
        maxAge: 2592000000, // 30 days
      });
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        user: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        },
      });
    });

    it('should return error for invalid token', async () => {
      const token = 'invalid-token';
      authService.verifyIdToken.mockRejectedValue(new Error('Invalid token'));

      await controller.verifyToken({ token }, mockResponse);

      expect(authService.verifyIdToken).toHaveBeenCalledWith(token);
      expect(userService.findOrCreateUser).not.toHaveBeenCalled();
      expect(mockResponse.cookie).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid token',
      });
    });

    it('should handle user creation failure', async () => {
      const token = 'valid-firebase-token';
      const decodedToken = {
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

      authService.verifyIdToken.mockResolvedValue(decodedToken);
      userService.findOrCreateUser.mockRejectedValue(new Error('Database error'));

      await controller.verifyToken({ token }, mockResponse);

      expect(authService.verifyIdToken).toHaveBeenCalledWith(token);
      expect(userService.findOrCreateUser).toHaveBeenCalledWith(decodedToken);
      expect(mockResponse.cookie).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid token',
      });
    });
  });

  describe('logout', () => {
    it('should clear auth cookie and return success', async () => {
      await controller.logout(mockResponse);

      expect(mockResponse.clearCookie).toHaveBeenCalledWith('authToken');
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        message: 'Logged out successfully',
      });
    });
  });

  describe('getFirebaseConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return firebase config when all environment variables are set', () => {
      process.env.FIREBASE_API_KEY = 'test-api-key';
      process.env.FIREBASE_AUTH_DOMAIN = 'test-auth-domain';
      process.env.FIREBASE_PROJECT_ID = 'test-project-id';
      process.env.FIREBASE_STORAGE_BUCKET = 'test-storage-bucket';
      process.env.FIREBASE_MESSAGING_SENDER_ID = 'test-sender-id';
      process.env.FIREBASE_APP_ID = 'test-app-id';

      const config = controller.getFirebaseConfig();

      expect(config).toEqual({
        apiKey: 'test-api-key',
        authDomain: 'test-auth-domain',
        projectId: 'test-project-id',
        storageBucket: 'test-storage-bucket',
        messagingSenderId: 'test-sender-id',
        appId: 'test-app-id',
      });
    });

    it('should throw error when critical environment variables are missing', () => {
      process.env.FIREBASE_API_KEY = '';
      process.env.FIREBASE_AUTH_DOMAIN = 'test-auth-domain';
      process.env.FIREBASE_PROJECT_ID = 'test-project-id';

      expect(() => controller.getFirebaseConfig()).toThrow('Firebase configuration incomplete');
    });

    it('should throw error when project id is missing', () => {
      process.env.FIREBASE_API_KEY = 'test-api-key';
      process.env.FIREBASE_AUTH_DOMAIN = 'test-auth-domain';
      process.env.FIREBASE_PROJECT_ID = '';

      expect(() => controller.getFirebaseConfig()).toThrow('Firebase configuration incomplete');
    });
  });

  describe('getLoginPage', () => {
    it('should return login page HTML', async () => {
      await controller.getLoginPage(mockResponse);

      expect(mockResponse.send).toHaveBeenCalled();
      const htmlContent = mockResponse.send.mock.calls[0][0];
      expect(htmlContent).toContain('Sign in to ArXiv Learning Tool');
      expect(htmlContent).toContain('email');
      expect(htmlContent).toContain('password');
      expect(htmlContent).toContain('firebase');
    });
  });

  describe('getCurrentUser', () => {
    it('should return current user from request', async () => {
      const mockRequest = {
        user: { uid: 'user123', email: 'test@example.com' },
      };

      const result = await controller.getCurrentUser(mockRequest as any);

      expect(result).toEqual({
        success: true,
        user: mockRequest.user,
      });
    });
  });
});