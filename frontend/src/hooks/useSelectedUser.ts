import { useState } from "react";

interface UseSelectedUser {
  /** null means "My tasks" (current user context) */
  selectedUserId: string | null;
  setSelectedUserId: (id: string | null) => void;
}

/**
 * Hook for storing the currently selected user in the tab panel.
 * selectedUserId === null → "My tasks" view.
 */
export function useSelectedUser(): UseSelectedUser {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  return { selectedUserId, setSelectedUserId };
}
