import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { GuidedTourStep } from './types';
import GuidedTourExampleTable from './GuidedTourExampleTable';

/** Définition structurelle des étapes ; titres et textes via `guidedTour.steps.<i18nKey>.*`. */
export const GUIDED_TOUR_STEPS: GuidedTourStep[] = [
  { id: 'welcome', i18nKey: 'welcome', path: '/' },
  { id: 'navigation', i18nKey: 'navigation', highlight: 'sidebar-nav' },
  { id: 'profiles', i18nKey: 'profiles', path: '/settings', highlight: 'settings-profiles' },
  { id: 'accounts', i18nKey: 'accounts', path: '/settings', highlight: 'settings-accounts' },
  { id: 'entry-types', i18nKey: 'entryTypes', path: '/settings', highlight: 'settings-entry-types' },
  { id: 'output-types', i18nKey: 'outputTypes', path: '/settings', highlight: 'settings-output-types' },
  { id: 'projects', i18nKey: 'projects', path: '/settings', highlight: 'settings-projects' },
  { id: 'data-format', i18nKey: 'dataFormat', path: '/settings' },
  { id: 'dashboard', i18nKey: 'dashboard', path: '/', highlight: 'nav-/' },
  { id: 'transactions', i18nKey: 'transactions', path: '/transactions', highlight: 'nav-/transactions' },
  {
    id: 'account-balance',
    i18nKey: 'accountBalance',
    path: '/account-balance',
    highlight: 'nav-/account-balance',
  },
  {
    id: 'monthly-accounting',
    i18nKey: 'monthlyAccounting',
    path: '/monthly-accounting',
    highlight: 'nav-/monthly-accounting',
  },
  { id: 'annual-budget', i18nKey: 'annualBudget', path: '/annual-budget', highlight: 'nav-/annual-budget' },
  { id: 'support', i18nKey: 'support', path: '/soutien', highlight: 'nav-/soutien' },
  { id: 'finish', i18nKey: 'finish', path: '/' },
];

const CODE_CLASS = 'text-xs bg-slate-100 px-1 rounded';

/** Balises riches des textes traduits (`<strong>`, `<code>`). */
const RICH_COMPONENTS = {
  strong: <strong />,
  code: <code className={CODE_CLASS} />,
};

type ParagraphSpec = { key: string; className?: string };

function Paragraphs({ stepKey, items }: { stepKey: string; items: ParagraphSpec[] }) {
  return (
    <>
      {items.map(({ key, className }) => (
        <p key={key} className={className}>
          <Trans i18nKey={`guidedTour.steps.${stepKey}.${key}`} components={RICH_COMPONENTS} />
        </p>
      ))}
    </>
  );
}

const DataFormatBody: React.FC = () => {
  const { t } = useTranslation();
  const k = 'guidedTour.steps.dataFormat';
  return (
    <>
      <p className="text-sm text-gray-700">
        <Trans i18nKey={`${k}.intro`} components={RICH_COMPONENTS} />
      </p>

      <p className="mt-3 font-medium text-gray-800 text-sm">{t(`${k}.processedHeading`)}</p>
      <GuidedTourExampleTable
        fileName="src_transaction_data.csv"
        caption={t(`${k}.processedCaption`)}
        headers={['DATE', 'TITLE', 'AMOUNT', 'CURRENCY', 'ACCOUNT', 'AMOUNT GBP', 'TYPE', 'PROJET']}
        rows={[
          ['15.03.26', t(`${k}.sample.groceries`), '-42,50', 'EUR', 'Revolut Perso', '-36,55', 'Food', 'maison-01'],
          ['28.02.26', t(`${k}.sample.salary`), '3 200,00', 'GBP', 'HSBC Joint', '3 200,00', 'Firm', ''],
          ['03.02.26', t(`${k}.sample.rent`), '-850,00', 'GBP', 'HSBC Joint', '-850,00', 'Rent', 'maison-01'],
        ]}
      />

      <p className="mt-3 font-medium text-gray-800 text-sm">{t(`${k}.importHeading`)}</p>
      <GuidedTourExampleTable
        fileName="releve_banque.csv"
        caption={t(`${k}.importCaption`)}
        headers={['DATE', 'TITLE', 'EXPENSE', 'INCOME', 'ACCOUNT']}
        rows={[
          ['14.03.26', t(`${k}.sample.importFood`), '12,80', '', 'Revolut Perso'],
          ['01.03.26', t(`${k}.sample.importSalary`), '', '3 200,00', 'HSBC Joint'],
          ['28.02.26', 'SPOTIFY', '9,99', '', 'Revolut Perso'],
        ]}
      />

      <p className="mt-3 font-medium text-gray-800 text-sm">{t(`${k}.balanceHeading`)}</p>
      <GuidedTourExampleTable
        fileName="src_account_balance.csv"
        caption={t(`${k}.balanceCaption`)}
        headers={['DATE', 'Revolut Perso', 'HSBC Joint']}
        rows={[
          ['01.03.26', '1 245,30', '8 420,00'],
          ['01.02.26', '892,10', '6 100,50'],
          ['01.01.26', '1 104,00', '5 880,25'],
        ]}
      />

      <p className="mt-3 text-xs text-gray-600">
        <Trans i18nKey={`${k}.rates`} components={RICH_COMPONENTS} />
      </p>
    </>
  );
};

/** Paragraphes (clé + classe) par étape ; `dataFormat` a un rendu dédié. */
const STEP_PARAGRAPHS: Record<string, ParagraphSpec[]> = {
  welcome: [{ key: 'p1' }, { key: 'p2', className: 'mt-2' }],
  navigation: [{ key: 'p1' }, { key: 'p2', className: 'mt-2 text-sm text-gray-600' }],
  profiles: [{ key: 'p1' }, { key: 'p2', className: 'mt-2' }],
  accounts: [
    { key: 'p1' },
    { key: 'p2', className: 'mt-2' },
    { key: 'p3', className: 'mt-2 text-sm text-amber-800' },
  ],
  entryTypes: [{ key: 'p1' }, { key: 'p2', className: 'mt-2' }],
  outputTypes: [{ key: 'p1' }],
  projects: [{ key: 'p1' }, { key: 'p2', className: 'mt-2' }],
  dashboard: [{ key: 'p1' }, { key: 'p2', className: 'mt-2 text-sm text-gray-600' }],
  transactions: [{ key: 'p1' }],
  accountBalance: [{ key: 'p1' }],
  monthlyAccounting: [{ key: 'p1' }],
  annualBudget: [{ key: 'p1' }],
  support: [{ key: 'p1' }],
  finish: [{ key: 'p1' }, { key: 'p2', className: 'mt-2 text-sm text-gray-600' }],
};

/** Corps traduit d’une étape. */
export const GuidedTourStepBody: React.FC<{ step: GuidedTourStep }> = ({ step }) => {
  if (step.i18nKey === 'dataFormat') return <DataFormatBody />;
  const items = STEP_PARAGRAPHS[step.i18nKey] ?? [];
  return <Paragraphs stepKey={step.i18nKey} items={items} />;
};
