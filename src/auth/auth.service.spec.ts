import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import * as admin from 'firebase-admin';

// Mock firebase-admin
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: {
    applicationDefault: jest.fn(),
  },
  auth: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let mockAuth: jest.Mocked<admin.auth.Auth>;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock admin.apps.length to return 0 initially
    Object.defineProperty(admin, 'apps', {
      value: [],
      writable: true,
    });

    // Create mock auth instance
    mockAuth = {
      verifyIdToken: jest.fn(),
      getUser: jest.fn(),
      createCustomToken: jest.fn(),
      deleteUser: jest.fn(),
    } as any;

    // Mock admin.auth() to return our mock
    (admin.auth as jest.Mock).mockReturnValue(mockAuth);

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('constructor', () => {
    it('should initialize Firebase Admin SDK when no apps exist', () => {
      expect(admin.initializeApp).toHaveBeenCalledWith({
        credential: admin.credential.applicationDefault(),
      });
    });

    it('should not initialize Firebase Admin SDK when apps already exist', () => {
      jest.clearAllMocks();
      
      // Mock apps.length to return 1
      Object.defineProperty(admin, 'apps', {
        value: [{}], // Simulate existing app
        writable: true,
      });

      // Create new service instance
      new AuthService();

      expect(admin.initializeApp).not.toHaveBeenCalled();
    });
  });

  describe('verifyIdToken', () => {
    it('should verify valid token and return decoded token', async () => {
      const mockDecodedToken = {
        uid: 'user123',
        email: 'test@example.com',
        aud: 'project-id',
        iss: 'https://securetoken.google.com/project-id',
      } as admin.auth.DecodedIdToken;

      mockAuth.verifyIdToken.mockResolvedValue(mockDecodedToken);

      const result = await service.verifyIdToken('valid-token');

      expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('valid-token');
      expect(result).toEqual(mockDecodedToken);
    });

    it('should throw error for invalid token', async () => {
      mockAuth.verifyIdToken.mockRejectedValue(new Error('Firebase error'));

      await expect(service.verifyIdToken('invalid-token')).rejects.toThrow('Invalid token');
      expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('invalid-token');
    });

    it('should throw error for expired token', async () => {
      mockAuth.verifyIdToken.mockRejectedValue(new Error('Token expired'));

      await expect(service.verifyIdToken('expired-token')).rejects.toThrow('Invalid token');
    });
  });

  describe('getUser', () => {
    it('should return user record for valid uid', async () => {
      const mockUserRecord = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Test User',
      } as admin.auth.UserRecord;

      mockAuth.getUser.mockResolvedValue(mockUserRecord);

      const result = await service.getUser('user123');

      expect(mockAuth.getUser).toHaveBeenCalledWith('user123');
      expect(result).toEqual(mockUserRecord);
    });

    it('should throw error for non-existent user', async () => {
      mockAuth.getUser.mockRejectedValue(new Error('No user record found'));

      await expect(service.getUser('non-existent')).rejects.toThrow('User not found');
      expect(mockAuth.getUser).toHaveBeenCalledWith('non-existent');
    });
  });

  describe('createCustomToken', () => {
    it('should create custom token for valid uid', async () => {
      const mockToken = 'custom-token-123';
      mockAuth.createCustomToken.mockResolvedValue(mockToken);

      const result = await service.createCustomToken('user123');

      expect(mockAuth.createCustomToken).toHaveBeenCalledWith('user123');
      expect(result).toBe(mockToken);
    });

    it('should throw error when token creation fails', async () => {
      mockAuth.createCustomToken.mockRejectedValue(new Error('Token creation failed'));

      await expect(service.createCustomToken('user123')).rejects.toThrow('Failed to create custom token');
    });
  });

  describe('deleteUser', () => {
    it('should delete user successfully', async () => {
      mockAuth.deleteUser.mockResolvedValue();

      await service.deleteUser('user123');

      expect(mockAuth.deleteUser).toHaveBeenCalledWith('user123');
    });

    it('should throw error when user deletion fails', async () => {
      mockAuth.deleteUser.mockRejectedValue(new Error('User deletion failed'));

      await expect(service.deleteUser('user123')).rejects.toThrow('Failed to delete user');
    });

    it('should throw error when trying to delete non-existent user', async () => {
      mockAuth.deleteUser.mockRejectedValue(new Error('No user record found'));

      await expect(service.deleteUser('non-existent')).rejects.toThrow('Failed to delete user');
    });
  });
});