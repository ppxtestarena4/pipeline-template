import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { AuthRequest, AuthPayload } from '../types';
import { UserRole } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production_jwt_secret';

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const apiTokenHeader = req.headers['x-api-token'] as string | undefined;

    if (apiTokenHeader) {
      // API token auth for AI agents
      const user = await prisma.user.findUnique({
        where: { apiToken: apiTokenHeader },
      });

      if (!user) {
        res.status(401).json({ error: 'Invalid API token' });
        return;
      }

      req.user = {
        userId: user.id,
        email: user.email,
        role: user.role,
        type: user.type,
      };
      next();
      return;
    }

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);

      try {
        const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
        req.user = payload;
        next();
        return;
      } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
    }

    res.status(401).json({ error: 'Authentication required' });
  } catch (error) {
    res.status(500).json({ error: 'Authentication error' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
