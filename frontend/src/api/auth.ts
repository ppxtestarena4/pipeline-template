import client from "./client";

const TOKEN_KEY = "access_token";

export interface TokenResponse {
  access_token: string;
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const { data } = await client.post<TokenResponse>("/auth/login", { email, password });
  return data;
}

export async function register(
  email: string,
  password: string,
  name: string
): Promise<TokenResponse> {
  const { data } = await client.post<TokenResponse>("/auth/register", { email, password, name });
  return data;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
}
