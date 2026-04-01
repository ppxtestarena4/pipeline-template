// API functions for user-related endpoints

export interface User {
  id: string;
  email: string;
  name: string;
  role: "manager" | "employee" | "ai_agent" | "admin";
  user_type: "human" | "ai";
  parent_id: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
}

const BASE_URL = "/api";

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** GET /api/users/me — returns the currently authenticated user */
export async function getMe(): Promise<User> {
  const res = await fetch(`${BASE_URL}/users/me`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<User>(res);
}

/** GET /api/users/me/direct-reports — returns direct reports of the current user */
export async function getDirectReports(): Promise<User[]> {
  const res = await fetch(`${BASE_URL}/users/me/direct-reports`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<User[]>(res);
}
