import React from 'react';
import type { User } from '../types';

interface Props {
  currentUser: User;
  directReports: User[];
  selectedId: string | null; // null = "My tasks"
  onSelect: (id: string | null) => void;
  taskCounts?: Record<string, number>; // userId -> count of attention tasks
}

export default function DirectReportTabs({
  currentUser,
  directReports,
  selectedId,
  onSelect,
  taskCounts = {},
}: Props) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {/* "My tasks" tab */}
      <button
        onClick={() => onSelect(null)}
        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
          selectedId === null
            ? 'bg-blue-600 text-white'
            : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
        }`}
      >
        <span>📌</span>
        <span>Мои</span>
        {taskCounts[currentUser.id] > 0 && (
          <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold ${
            selectedId === null ? 'bg-blue-500 text-white' : 'bg-red-100 text-red-700'
          }`}>
            {taskCounts[currentUser.id]}
          </span>
        )}
      </button>

      {/* Direct report tabs */}
      {directReports.map(report => (
        <button
          key={report.id}
          onClick={() => onSelect(report.id)}
          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            selectedId === report.id
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-xs">
            {report.name.slice(0, 1)}
          </div>
          <span>{report.name}</span>
          {taskCounts[report.id] > 0 && (
            <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold ${
              selectedId === report.id ? 'bg-blue-500 text-white' : 'bg-red-100 text-red-700'
            }`}>
              {taskCounts[report.id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
