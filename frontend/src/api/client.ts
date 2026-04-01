import axios from "axios";
import { getToken } from "./auth";

const baseURL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const client = axios.create({ baseURL });

// Attach JWT to every request
client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// On 401 — redirect to login
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default client;
