import { Request } from 'express';
import { UserRole, UserType } from '@prisma/client';

export interface AuthPayload {
  userId: string;
  email: string;
  role: UserRole;
  type: UserType;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}
