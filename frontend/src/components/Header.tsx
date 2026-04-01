import React, { useEffect, useState } from "react";
import { getMe, getDirectReports, User } from "../api/users";

interface HeaderProps {
  /** Currently selected user id; null = "My tasks" */
  selectedUserId: string | null;
  onChange: (userId: string | null) => void;
}

/**
 * Application header with:
 *  - Logo / system name (left)
 *  - Current user avatar + name + logout button (right)
 *  - Tab panel below the header bar (only rendered for managers with direct reports):
 *      [📌 My tasks] [Report 1] [Report 2] …
 */
export const Header: React.FC<HeaderProps> = ({ selectedUserId, onChange }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [directReports, setDirectReports] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [me, reports] = await Promise.all([getMe(), getDirectReports()]);
        if (!cancelled) {
          setCurrentUser(me);
          setDirectReports(reports);
        }
      } catch {
        // Silently handle auth errors; parent app should redirect on 401
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleLogout() {
    localStorage.removeItem("access_token");
    window.location.href = "/login";
  }

  const hasTabs = directReports.length > 0;

  return (
    <header className="sticky top-0 z-50 w-full bg-white shadow">
      {/* Main header bar */}
      <div className="flex items-center justify-between px-6 py-3">
        {/* Logo / system name */}
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-primary-600 tracking-tight">
            TaskManager
          </span>
        </div>

        {/* Right side: avatar + name + logout */}
        <div className="flex items-center gap-3">
          {!loading && currentUser && (
            <>
              {currentUser.avatar_url ? (
                <img
                  src={currentUser.avatar_url}
                  alt={currentUser.name}
                  className="h-8 w-8 rounded-full object-cover border border-gray-200"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-semibold text-sm select-none">
                  {currentUser.name.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-sm font-medium text-gray-700">
                {currentUser.name}
              </span>
            </>
          )}
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-red-600 transition-colors px-2 py-1 rounded hover:bg-red-50"
          >
            Выйти
          </button>
        </div>
      </div>

      {/* Tab panel — only for managers with direct reports */}
      {hasTabs && (
        <div className="flex items-center gap-1 px-6 pb-0 border-t border-gray-100 bg-gray-50">
          {/* "My tasks" tab — always first */}
          <TabButton
            label="📌 Мои задачи"
            active={selectedUserId === null}
            onClick={() => onChange(null)}
          />

          {directReports.map((report) => (
            <TabButton
              key={report.id}
              label={report.name}
              active={selectedUserId === report.id}
              onClick={() => onChange(report.id)}
            />
          ))}
        </div>
      )}
    </header>
  );
};

interface TabButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function TabButton({ label, active, onClick }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
        active
          ? "border-primary-600 text-primary-600"
          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
