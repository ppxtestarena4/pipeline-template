import { WebSocket } from 'ws';
import { prisma } from '../db';
import { NotificationType } from '@prisma/client';

// Map from user's JWT token to WebSocket connection (for real-time push)
export const wsClients = new Map<string, WebSocket>();

export async function createNotification(
  userId: string,
  type: NotificationType,
  content: string,
  taskId?: string
) {
  const notification = await prisma.notification.create({
    data: { userId, type, content, taskId },
  });

  // Push via WebSocket if user is connected
  for (const [, ws] of wsClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'notification', data: notification }));
    }
  }

  return notification;
}
