import { getAPIBaseUrl } from '@/services/environment';
import { fetchWithTimeout } from '@/utils/fetch';
const SHARE_API = getAPIBaseUrl() + '/share';

export interface ShareMetadata {
  title: string;
  author: string | null;
  format: string;
  size: number;
  expiresAt: string;
  hasCover: boolean;
  hasCfi: boolean;
  downloadCount: number;
  // Owner-only fields (returned only when the caller is the sharer).
  token?: string;
  bookHash?: string;
  createdAt?: string;
  revokedAt?: string | null;
}

export class ShareApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ShareApiError';
  }
}

const parseError = async (response: Response): Promise<ShareApiError> => {
  let code: string | undefined;
  let message = response.statusText || 'Request failed';
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    if (body?.error) message = body.error;
    if (body?.code) code = body.code;
  } catch {
    // Body wasn't JSON; keep the default message.
  }
  return new ShareApiError(response.status, code, message);
};

export const getShare = async (token: string): Promise<ShareMetadata> => {
  const response = await fetchWithTimeout(`${SHARE_API}/${encodeURIComponent(token)}`, {
    method: 'GET',
    cache: 'no-store',
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as ShareMetadata;
};
