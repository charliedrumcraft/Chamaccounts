import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

type Props = {
  count: number;
  onDismiss: () => void;
  /** Variante soldes vs transactions. */
  kind?: 'transactions' | 'balances';
};

/** Bandeau post-import avec CTA vers le Dashboard. */
const ImportSuccessBanner: React.FC<Props> = ({ count, onDismiss, kind = 'transactions' }) => {
  const { t } = useTranslation();
  const messageKey =
    kind === 'balances' ? 'importSuccess.balancesMessage' : 'importSuccess.transactionsMessage';

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm"
    >
      <p className="text-sm font-medium text-emerald-950">{t(messageKey, { count })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/"
          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
        >
          {t('importSuccess.viewDashboard')}
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100/60"
        >
          {t('importSuccess.dismiss')}
        </button>
      </div>
    </div>
  );
};

export default ImportSuccessBanner;
