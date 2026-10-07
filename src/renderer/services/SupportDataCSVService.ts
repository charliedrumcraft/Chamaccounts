/**
 * Lignes Support (SQLite support.db via IPC ; CSV miroir Support_data.csv).
 */

import { SUPPORT_DATA_CSV_PATH } from '@/shared/dataPaths';
import { stripAccountColumnFromSupportData } from './SourceDataCSVService';
import type { SourceDataResult } from './SourceDataCSVService';
import i18n from '../i18n';

export { SUPPORT_DATA_CSV_PATH };

export class SupportDataCSVService {
  static async load(): Promise<SourceDataResult | null> {
    try {
      const api = (
        window as unknown as {
          electronAPI?: {
            supportGetAll?: () => Promise<{
              success: boolean;
              data?: SourceDataResult | null;
              error?: string;
            }>;
          };
        }
      ).electronAPI;
      if (!api?.supportGetAll) return null;
      const result = await api.supportGetAll();
      if (!result.success || !result.data) return null;
      return stripAccountColumnFromSupportData(result.data);
    } catch {
      return null;
    }
  }

  static async replaceAll(rows: Record<string, string>[]): Promise<{ success: boolean; error?: string }> {
    try {
      const api = (
        window as unknown as {
          electronAPI?: {
            supportReplaceAll?: (
              rows: Record<string, string>[]
            ) => Promise<{ success: boolean; error?: string; count: number }>;
          };
        }
      ).electronAPI;
      if (!api?.supportReplaceAll) {
        return { success: false, error: i18n.t('system.apiUnavailable', { name: 'supportReplaceAll' }) };
      }
      const result = await api.supportReplaceAll(rows);
      return { success: result.success, error: result.error };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}
