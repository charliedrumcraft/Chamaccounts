import React from 'react';
import { useTranslation } from 'react-i18next';
import WorkingCurrenciesSettingsSection from '../components/Settings/WorkingCurrenciesSettingsSection';
import ProjectsSection from '../components/Settings/ProjectsSection';
import RecognisedDataSection from '../components/Settings/RecognisedDataSection';
import MappingProfilesSection from '../components/Settings/MappingProfilesSection';

const ProfileSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 w-full max-w-[1600px] mx-auto">
      <h1 className="text-2xl font-bold text-gray-800">{t('profileSettings.title')}</h1>

      <div className="mt-6 flex flex-col gap-8 w-full">
        <WorkingCurrenciesSettingsSection />
        <ProjectsSection />
        <RecognisedDataSection />
        <MappingProfilesSection />
      </div>
    </main>
  );
};

export default ProfileSettings;
