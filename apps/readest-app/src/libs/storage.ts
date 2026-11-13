import { isWebAppPlatform } from '@/services/environment';
import { AppService } from '@/types/system';
import { tauriDownload, webDownload, ProgressHandler, ProgressPayload } from '@/utils/transfer';

export const createProgressHandler = (
  totalFiles: number,
  completedFilesRef: { count: number },
  onProgress?: ProgressHandler,
) => {
  return (progress: ProgressPayload) => {
    const fileProgress = progress.progress / progress.total;
    const overallProgress = ((completedFilesRef.count + fileProgress) / totalFiles) * 100;

    if (onProgress) {
      onProgress({
        progress: overallProgress,
        total: 100,
        transferSpeed: progress.transferSpeed,
      });
    }
  };
};

type DownloadFileParams = {
  appService: AppService;
  dst: string;
  cfp: string;
  url: string;
  headers?: Record<string, string>;
  singleThreaded?: boolean;
  skipSslVerification?: boolean;
  onProgress?: ProgressHandler;
};

export const downloadFile = async ({
  appService,
  dst,
  url,
  headers,
  singleThreaded,
  skipSslVerification,
  onProgress,
}: DownloadFileParams) => {
  try {
    const downloadUrl = url;
    if (!downloadUrl) throw new Error('No download URL available');

    if (isWebAppPlatform()) {
      const { headers: responseHeaders, blob } = await webDownload(
        downloadUrl,
        onProgress,
        headers,
      );
      await appService.writeFile(dst, 'None', await blob.arrayBuffer());
      return responseHeaders;
    } else {
      return await tauriDownload(
        downloadUrl,
        dst,
        onProgress,
        headers,
        undefined,
        singleThreaded,
        skipSslVerification,
      );
    }
  } catch (error) {
    console.error(`File '${dst}' download failed:`, error);
    throw error;
  }
};
