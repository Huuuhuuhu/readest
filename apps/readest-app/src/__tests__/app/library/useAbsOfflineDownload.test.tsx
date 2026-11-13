import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Book } from '@/types/book';
const queueAbsOfflineDownload = vi.hoisted(() => vi.fn(() => 'transfer-1'));
vi.mock('@/services/transferManager', () => ({ transferManager: { queueAbsOfflineDownload } }));
const { useAbsOfflineDownload } = await import('@/app/library/hooks/useAbsOfflineDownload');
const book = { hash: 'h1', format: 'ABS', title: 'Alice' } as Book;
beforeEach(() => vi.clearAllMocks());
describe('independent Audiobookshelf downloads', () => {
  it('queues a local download without an account or entitlement provider', () => {
    const { result } = renderHook(() => useAbsOfflineDownload());
    result.current.handleBookOfflineDownload(book);
    expect(queueAbsOfflineDownload).toHaveBeenCalledExactlyOnceWith(book, 1);
  });
  it('queues each selected book once', () => {
    const other = { ...book, hash: 'h2' };
    renderHook(() => useAbsOfflineDownload()).result.current.handleBooksOfflineDownload([
      book,
      other,
    ]);
    expect(queueAbsOfflineDownload).toHaveBeenCalledTimes(2);
    expect(queueAbsOfflineDownload).toHaveBeenCalledWith(other, 1);
  });
  it('does nothing for an empty selection', () => {
    renderHook(() => useAbsOfflineDownload()).result.current.handleBooksOfflineDownload([]);
    expect(queueAbsOfflineDownload).not.toHaveBeenCalled();
  });
});
