/** Profil de données : dossier CSV + AppState indépendant. */
export type Profile = {
  id: string;
  name: string;
  dataRoot: string;
};

export type AppConfig = {
  version: 1;
  activeProfileId: string;
  profiles: Profile[];
};

export type LegacyDataLocation = {
  path: string;
  label: string;
  suggestedName: string;
};

export type DataSetupStatus = {
  needsSetup: boolean;
  profiles: Profile[];
  activeProfileId: string | null;
  activeDataRoot: string | null;
  legacyLocations: LegacyDataLocation[];
};
