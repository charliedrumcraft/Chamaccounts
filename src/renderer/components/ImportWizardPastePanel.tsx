import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export type ImportWizardPastePanelProps = {
  description: string;
  pasteTitle?: string;
  pastePlaceholder?: string;
  pasteNoHeaderLabel?: string;
  pasteAddLabel?: string;
  disabled?: boolean;
  onPaste: (raw: string, options: { firstLineAsData: boolean }) => void;
  /** Contenu optionnel sous les boutons (sources, vider le lot, etc.). */
  footer?: React.ReactNode;
};

/**
 * Bloc « Coller depuis un tableur » — partagé TX / AB / Soutien (zone Préparation de l’import).
 */
const ImportWizardPastePanel: React.FC<ImportWizardPastePanelProps> = ({
  description,
  pasteTitle,
  pastePlaceholder,
  pasteNoHeaderLabel,
  pasteAddLabel,
  disabled = false,
  onPaste,
  footer,
}) => {
  const { t } = useTranslation();
  const [clipboardDraft, setClipboardDraft] = useState('');
  const [pasteFirstLineAsData, setPasteFirstLineAsData] = useState(false);

  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 max-w-3xl">
      <p className="text-xs font-medium text-gray-700 mb-1">
        {pasteTitle ?? t('transactions.importPrep.pasteTitle')}
      </p>
      <p className="text-[11px] text-gray-500 mb-2">{description}</p>
      <textarea
        value={clipboardDraft}
        onChange={(e) => setClipboardDraft(e.target.value)}
        spellCheck={false}
        rows={4}
        placeholder={pastePlaceholder ?? t('transactions.importPrep.pastePlaceholder')}
        disabled={disabled}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs font-mono text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={pasteFirstLineAsData}
            onChange={(e) => setPasteFirstLineAsData(e.target.checked)}
            disabled={disabled}
            className="rounded border-gray-400"
          />
          {pasteNoHeaderLabel ?? t('transactions.importPrep.pasteNoHeader')}
        </label>
        <button
          type="button"
          disabled={disabled || !clipboardDraft.trim()}
          onClick={() => {
            onPaste(clipboardDraft, { firstLineAsData: pasteFirstLineAsData });
            setClipboardDraft('');
          }}
          className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {pasteAddLabel ?? t('transactions.importPrep.pasteAdd')}
        </button>
      </div>
      {footer}
    </div>
  );
};

export default ImportWizardPastePanel;
