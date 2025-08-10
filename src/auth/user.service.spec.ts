/* eslint-disable @typescript-eslint/no-unsafe-assignment */
 
 
 
 
 
import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { UserRepository } from '../data/repositories/user.repository';
import { User } from '../firestore/interfaces/firestore.interfaces';

describe('UserService', () => {
  let service: UserService;
  let userRepository: jest.Mocked<UserRepository>;

  beforeEach(async () => {
    const mockUserRepository = {
      findByUid: jest.fn(),
      createUser: jest.fn(),
      updateUser: jest.fn(),
      deleteUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: UserRepository,
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get(UserRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findOrCreateUser', () => {
    it('should create new user when user does not exist', async () => {
      const firebaseUser = {
        uid: 'user123',
        email: 'test@example.com',
        name: 'Test User',
        picture: 'https://example.com/photo.jpg',
      };

      userRepository.findByUid.mockResolvedValue(null);
      userRepository.createUser.mockResolvedValue();

      const result = await service.findOrCreateUser(firebaseUser);

      expect(userRepository.findByUid).toHaveBeenCalledWith('user123');
      expect(userRepository.createUser).toHaveBeenCalledWith({
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Test User',
        photoURL: 'https://example.com/photo.jpg',
        createdAt: expect.any(Date),
      });
      expect(result).toEqual({
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Test User',
        photoURL: 'https://example.com/photo.jpg',
        createdAt: expect.any(Date),
      });
    });

    it('should create user with displayName fallback', async () => {
      const firebaseUser = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Display Name',
      };

      userRepository.findByUid.mockResolvedValue(null);
      userRepository.createUser.mockResolvedValue();

      await service.findOrCreateUser(firebaseUser);

      expect(userRepository.createUser).toHaveBeenCalledWith({
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Display Name',
        photoURL: null,
        createdAt: expect.any(Date),
      });
    });

    it('should create user with null values when name/picture not provided', async () => {
      const firebaseUser = {
        uid: 'user123',
        email: 'test@example.com',
      };

      userRepository.findByUid.mockResolvedValue(null);
      userRepository.createUser.mockResolvedValue();

      await service.findOrCreateUser(firebaseUser);

      expect(userRepository.createUser).toHaveBeenCalledWith({
        uid: 'user123',
        email: 'test@example.com',
        displayName: null,
        photoURL: null,
        createdAt: expect.any(Date),
      });
    });

    it('should return existing user when no updates needed', async () => {
      const firebaseUser = {
        uid: 'user123',
        email: 'test@example.com',
        name: 'Test User',
        picture: 'https://example.com/photo.jpg',
      };

      const existingUser: User = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Test User',
        photoURL: 'https://example.com/photo.jpg',
        createdAt: new Date('2023-01-01'),
      };

      userRepository.findByUid.mockResolvedValue(existingUser);

      const result = await service.findOrCreateUser(firebaseUser);

      expect(userRepository.findByUid).toHaveBeenCalledWith('user123');
      expect(userRepository.updateUser).not.toHaveBeenCalled();
      expect(result).toEqual(existingUser);
    });

    it('should update existing user when email changes', async () => {
      const firebaseUser = {
        uid: 'user123',
        email: 'newemail@example.com',
        name: 'Test User',
        picture: 'https://example.com/photo.jpg',
      };

      const existingUser: User = {
        uid: 'user123',
        email: 'oldemail@example.com',
        displayName: 'Test User',
        photoURL: 'https://example.com/photo.jpg',
        createdAt: new Date('2023-01-01'),
      };

      userRepository.findByUid.mockResolvedValue(existingUser);
      userRepository.updateUser.mockResolvedValue();

      const result = await service.findOrCreateUser(firebaseUser);

      expect(userRepository.updateUser).toHaveBeenCalledWith('user123', {
        email: 'newemail@example.com',
      });
      expect(result).toEqual({
        ...existingUser,
        email: 'newemail@example.com',
      });
    });

    it('should update existing user when displayName changes', async () => {
      const firebaseUser = {
        uid: 'user123',
        email: 'test@example.com',
        name: 'New Name',
      };

      const existingUser: User = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Old Name',
        photoURL: null,
        createdAt: new Date('2023-01-01'),
      };

      userRepository.findByUid.mockResolvedValue(existingUser);
      userRepository.updateUser.mockResolvedValue();

      const result = await service.findOrCreateUser(firebaseUser);

      expect(userRepository.updateUser).toHaveBeenCalledWith('user123', {
        displayName: 'New Name',
      });
      expect(result).toEqual({
        ...existingUser,
        displayName: 'New Name',
      });
    });

    it('should update existing user when photoURL changes', async () => {
      const firebaseUser = {
        uid: 'user123',
        email: 'test@example.com',
        picture: 'https://example.com/newphoto.jpg',
      };

      const existingUser: User = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: null,
        photoURL: 'https://example.com/oldphoto.jpg',
        createdAt: new Date('2023-01-01'),
      };

      userRepository.findByUid.mockResolvedValue(existingUser);
      userRepository.updateUser.mockResolvedValue();

      const result = await service.findOrCreateUser(firebaseUser);

      expect(userRepository.updateUser).toHaveBeenCalledWith('user123', {
        photoURL: 'https://example.com/newphoto.jpg',
      });
      expect(result).toEqual({
        ...existingUser,
        photoURL: 'https://example.com/newphoto.jpg',
      });
    });

    it('should update multiple fields when they change', async () => {
      const firebaseUser = {
        uid: 'user123',
        email: 'newemail@example.com',
        name: 'New Name',
        picture: 'https://example.com/newphoto.jpg',
      };

      const existingUser: User = {
        uid: 'user123',
        email: 'oldemail@example.com',
        displayName: 'Old Name',
        photoURL: 'https://example.com/oldphoto.jpg',
        createdAt: new Date('2023-01-01'),
      };

      userRepository.findByUid.mockResolvedValue(existingUser);
      userRepository.updateUser.mockResolvedValue();

      const result = await service.findOrCreateUser(firebaseUser);

      expect(userRepository.updateUser).toHaveBeenCalledWith('user123', {
        email: 'newemail@example.com',
        displayName: 'New Name',
        photoURL: 'https://example.com/newphoto.jpg',
      });
      expect(result).toEqual({
        ...existingUser,
        email: 'newemail@example.com',
        displayName: 'New Name',
        photoURL: 'https://example.com/newphoto.jpg',
      });
    });

    it('should handle null to null updates correctly', async () => {
      const firebaseUser = {
        uid: 'user123',
        email: 'test@example.com',
      };

      const existingUser: User = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: null,
        photoURL: null,
        createdAt: new Date('2023-01-01'),
      };

      userRepository.findByUid.mockResolvedValue(existingUser);

      const result = await service.findOrCreateUser(firebaseUser);

      expect(userRepository.updateUser).not.toHaveBeenCalled();
      expect(result).toEqual(existingUser);
    });
  });

  describe('findByUid', () => {
    it('should return user when found', async () => {
      const user: User = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Test User',
        photoURL: null,
        createdAt: new Date(),
      };

      userRepository.findByUid.mockResolvedValue(user);

      const result = await service.findByUid('user123');

      expect(userRepository.findByUid).toHaveBeenCalledWith('user123');
      expect(result).toEqual(user);
    });

    it('should return null when user not found', async () => {
      userRepository.findByUid.mockResolvedValue(null);

      const result = await service.findByUid('non-existent');

      expect(userRepository.findByUid).toHaveBeenCalledWith('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('deleteUser', () => {
    it('should delete user successfully', async () => {
      userRepository.deleteUser.mockResolvedValue();

      await service.deleteUser('user123');

      expect(userRepository.deleteUser).toHaveBeenCalledWith('user123');
    });

    it('should handle deletion errors', async () => {
      userRepository.deleteUser.mockRejectedValue(new Error('Delete failed'));

      await expect(service.deleteUser('user123')).rejects.toThrow('Delete failed');
    });
  });
});