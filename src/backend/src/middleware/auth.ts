import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { UserRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  type: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'No authorization header' });
    return;
  }

  const [scheme, token] = authHeader.split(' ');

  // API token auth for AI agents
  if (scheme === 'Bearer' && token) {
    // Check if it's a JWT first
    try {
      const secret = process.env.JWT_SECRET!;
      const payload = jwt.verify(token, secret) as AuthUser;
      req.user = payload;
      return next();
    } catch {
      // Not a JWT — try API token
      const user = await prisma.user.findUnique({ where: { apiToken: token } });
      if (user) {
        req.user = { id: user.id, email: user.email, name: user.name, role: user.role, type: user.type };
        return next();
      }
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
  }

  res.status(401).json({ error: 'Invalid authorization scheme' });
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
