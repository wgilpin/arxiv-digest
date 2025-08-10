import { Request } from 'express';

export interface AuthUser {
  uid: string;
  email?: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}