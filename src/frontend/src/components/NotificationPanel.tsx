import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../api';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

interface Props { onClose: () => void }

export default function NotificationPanel({ onClose }: Props) {
  const qc = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list().then(r => r.data),
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute top-12 right-4 w-80 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-sm">Уведомления</h3>
          <button
            className="text-xs text-blue-600 hover:text-blue-800"
            onClick={() => markAllRead.mutate()}
          >
            Прочитать все
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="text-sm text-gray-500 p-4 text-center">Нет уведомлений</p>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                className={`px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${!n.read ? 'bg-blue-50' : ''}`}
                onClick={() => !n.read && markRead.mutate(n.id)}
              >
                <p className="text-sm text-gray-800">{n.content}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: ru })}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
