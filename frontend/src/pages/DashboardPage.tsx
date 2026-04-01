import React, { useState } from 'react';
import { KanbanBoard } from '../components/KanbanBoard';

/**
 * DashboardPage — main page of the application.
 *
 * Renders the KanbanBoard. The `selectedUserId` state is managed here and
 * will be wired to the Header component once TASK-012 is implemented.
 */
export const DashboardPage: React.FC = () => {
  // selectedUser comes from the Header (TASK-012); kept here as shared state
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>();

  return (
    <div className="dashboard-page">
      {/* Header will be inserted here by TASK-012 and will call setSelectedUserId */}
      <header className="dashboard-header">
        <h1 className="dashboard-header__title">TechTCB Task Manager</h1>
        {/* Placeholder user selector until TASK-012 Header is implemented */}
        <label className="dashboard-header__user-label">
          ID пользователя:
          <input
            className="dashboard-header__user-input"
            type="text"
            placeholder="Все пользователи"
            onChange={(e) =>
              setSelectedUserId(e.target.value.trim() || undefined)
            }
          />
        </label>
      </header>

      <main className="dashboard-main">
        <KanbanBoard selectedUserId={selectedUserId} />
      </main>
    </div>
  );
};
