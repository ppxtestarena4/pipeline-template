import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '../api';
import NotificationPanel from './NotificationPanel';

interface Props { children: React.ReactNode }

const navItems = [
  { to: '/dashboard', label: 'Дашборд', icon: '◻' },
  { to: '/board', label: 'Канбан', icon: '▦' },
  { to: '/intake', label: 'Входящие', icon: '↓' },
  { to: '/reports', label: 'Отчёты', icon: '📋' },
  { to: '/goals', label: 'Цели', icon: '🎯' },
  { to: '/projects', label: 'Проекты', icon: '📁' },
];

export default function Layout({ children }: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);

  const { data: notifications } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationsApi.list(true).then(r => r.data),
    refetchInterval: 30_000,
  });

  const unreadCount = notifications?.length || 0;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-blue-600">TechTCB</h1>
          <p className="text-xs text-gray-500 mt-0.5">Управление задачами</p>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-200">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
              {user?.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user?.name}</div>
              <div className="text-xs text-gray-500 truncate">{user?.role}</div>
            </div>
            <button
              onClick={logout}
              className="text-gray-400 hover:text-gray-600 text-xs"
              title="Выйти"
            >
              ⏻
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
          <div className="flex-1" />
          <button
            className="relative p-1.5 text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-100"
            onClick={() => setShowNotifications(!showNotifications)}
          >
            🔔
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>

      {/* Notification panel */}
      {showNotifications && (
        <NotificationPanel onClose={() => setShowNotifications(false)} />
      )}
    </div>
  );
}
