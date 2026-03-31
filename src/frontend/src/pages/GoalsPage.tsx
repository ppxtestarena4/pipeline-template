import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { goalsApi, usersApi, tasksApi } from '../api';
import { useAuth } from '../hooks/useAuth';
import { format, startOfWeek, addWeeks } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { GoalStatus } from '../types';

const statusColors: Record<GoalStatus, string> = {
  COMPLETED: 'bg-green-100 text-green-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  NOT_DONE: 'bg-gray-100 text-gray-600',
};

const statusLabels: Record<GoalStatus, string> = {
  COMPLETED: 'Выполнена',
  PARTIAL: 'Частично',
  NOT_DONE: 'Не выполнена',
};

function getWeekStart(offset = 0) {
  const d = addWeeks(new Date(), offset);
  return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

export default function GoalsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState(user!.id);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [newGoal, setNewGoal] = useState({ title: '', description: '', userId: user!.id });

  const weekStart = getWeekStart(weekOffset);
  const isManager = user?.role === 'MANAGER' || user?.role === 'ADMIN';

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
    enabled: isManager,
  });

  const { data: goals = [] } = useQuery({
    queryKey: ['goals', selectedUserId, weekStart],
    queryFn: () => goalsApi.list({ userId: selectedUserId, weekStart }).then(r => r.data),
  });

  const createGoal = useMutation({
    mutationFn: () => goalsApi.create({
      ...newGoal,
      weekStart,
    }),
    onSuccess: () => {
      setNewGoal({ title: '', description: '', userId: user!.id });
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });

  const updateGoal = useMutation({
    mutationFn: ({ id, status }: { id: string; status: GoalStatus }) =>
      goalsApi.update(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });

  const deleteGoal = useMutation({
    mutationFn: (id: string) => goalsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });

  const weekLabel = weekOffset === 0
    ? 'Текущая неделя'
    : weekOffset === -1
    ? 'Прошлая неделя'
    : weekOffset === 1
    ? 'Следующая неделя'
    : format(new Date(weekStart), "d MMM yyyy", { locale: ru });

  const completedCount = goals.filter(g => g.status === 'COMPLETED').length;
  const progress = goals.length > 0 ? Math.round((completedCount / goals.length) * 100) : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Еженедельные цели</h1>
        {isManager && (
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + Цель
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Week nav */}
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary text-sm px-2"
            onClick={() => setWeekOffset(w => w - 1)}
          >←</button>
          <span className="text-sm font-medium text-gray-700 min-w-32 text-center">{weekLabel}</span>
          <button
            className="btn-secondary text-sm px-2"
            onClick={() => setWeekOffset(w => w + 1)}
          >→</button>
        </div>

        {isManager && (
          <select
            className="input w-auto text-sm"
            value={selectedUserId}
            onChange={e => setSelectedUserId(e.target.value)}
          >
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>

      {/* Progress */}
      {goals.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Прогресс недели</span>
            <span className="text-sm font-bold text-gray-900">{completedCount}/{goals.length} ({progress}%)</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Goals list */}
      <div className="space-y-3">
        {goals.length === 0 && (
          <div className="card p-8 text-center">
            <p className="text-gray-400 text-sm">
              {isManager ? 'Нет целей. Нажмите «+ Цель» для добавления.' : 'Руководитель ещё не поставил цели на эту неделю.'}
            </p>
          </div>
        )}
        {goals.map(goal => (
          <div key={goal.id} className="card p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium text-gray-900">{goal.title}</h3>
                  <span className={`badge text-xs ${statusColors[goal.status]}`}>
                    {statusLabels[goal.status]}
                  </span>
                </div>
                {goal.description && (
                  <p className="text-sm text-gray-500 mb-2">{goal.description}</p>
                )}
                {goal.taskLinks.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {goal.taskLinks.map(link => (
                      <span key={link.taskId} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {link.task.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  className="text-xs border border-gray-200 rounded px-2 py-1"
                  value={goal.status}
                  onChange={e => updateGoal.mutate({ id: goal.id, status: e.target.value as GoalStatus })}
                >
                  <option value="NOT_DONE">Не выполнена</option>
                  <option value="PARTIAL">Частично</option>
                  <option value="COMPLETED">Выполнена</option>
                </select>
                {isManager && (
                  <button
                    className="text-xs text-red-400 hover:text-red-600"
                    onClick={() => deleteGoal.mutate(goal.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create goal modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Новая цель</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Сотрудник</label>
                <select
                  className="input"
                  value={newGoal.userId}
                  onChange={e => setNewGoal(g => ({ ...g, userId: e.target.value }))}
                >
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Цель *</label>
                <input
                  className="input"
                  placeholder="Что должно быть сделано к концу недели?"
                  value={newGoal.title}
                  onChange={e => setNewGoal(g => ({ ...g, title: e.target.value }))}
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Описание</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  placeholder="Дополнительный контекст..."
                  value={newGoal.description}
                  onChange={e => setNewGoal(g => ({ ...g, description: e.target.value }))}
                />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button className="btn-secondary" onClick={() => setShowCreate(false)}>Отмена</button>
                <button
                  className="btn-primary"
                  disabled={!newGoal.title.trim() || createGoal.isPending}
                  onClick={() => createGoal.mutate()}
                >
                  Создать
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
