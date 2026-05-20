/**
 * CSV data/SupportData/Support_data.csv — lignes Support ajoutées depuis la page Soutien.
 * Le fichier src_transaction_data.csv ne contient que l’import et les saisies du tableau Transactions.
 */

import { FileService } from './FileService';
import { SUPPORT_DATA_CSV_PATH } from '@/shared/dataPaths';
import { parseSourceTransactionCsvContent } from './SourceDataCSVService';
import type { SourceDataResult } from './SourceDataCSVService';

export { SUPPORT_DATA_CSV_PATH };

export class SupportDataCSVService {
  static async load(): Promise<SourceDataResult | null> {
    try {
      const content = await FileService.readFile(SUPPORT_DATA_CSV_PATH);
      if (!content?.trim()) return null;
      return parseSourceTransactionCsvContent(content);
    } catch {
      return null;
    }
  }
}
