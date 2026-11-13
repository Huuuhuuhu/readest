import { MetadataService } from '@/services/metadata/service';
import type { MetadataResult, SearchRequest } from '@/services/metadata/types';
const metadataService = new MetadataService({});
export const searchMetadata = (request: SearchRequest): Promise<MetadataResult[]> =>
  metadataService.search(request);
