import type { UserSummary } from '@uon/shared';
import { API_PREFIX } from '@uon/shared';

export interface UserRowLike {
  id: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
  avatarFileId: string | null;
  status: 'active' | 'inactive' | 'offboarded';
  isDemo: boolean;
}

export const avatarUrl = (userId: string, fileId: string | null) =>
  fileId ? `${API_PREFIX}/users/${userId}/avatar?v=${fileId.slice(0, 8)}` : null;

export function toUserSummary(u: UserRowLike): UserSummary {
  return {
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    jobTitle: u.jobTitle,
    avatarUrl: avatarUrl(u.id, u.avatarFileId),
    status: u.status,
    isDemo: u.isDemo,
  };
}

/** Column selection used everywhere a user summary is needed. */
export const userSummaryColumns = <T extends Record<string, unknown>>(t: T) => t;
