import { get, post, setCsrfToken } from './client';
import type { Me, SessionResponse } from './types';

function take(res: SessionResponse): Me {
  setCsrfToken(res.csrf_token);
  return res.user;
}

export async function fetchMe(): Promise<Me> {
  return take(await get<SessionResponse>('/auth/me'));
}

export async function login(employee_id: string, password: string): Promise<Me> {
  return take(await post<SessionResponse>('/auth/login', { employee_id, password }));
}

export async function logout(): Promise<void> {
  try {
    await post<void>('/auth/logout');
  } finally {
    setCsrfToken(null);
  }
}

export async function changePassword(current_password: string, new_password: string): Promise<Me> {
  return take(
    await post<SessionResponse>('/auth/change-password', { current_password, new_password }),
  );
}
