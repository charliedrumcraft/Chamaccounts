/** Préfixe des partitions Chromium (localStorage isolé par profil). */
export const PROFILE_SESSION_PARTITION_PREFIX = 'persist:chamaccounts-';

export function getProfileSessionPartition(profileId: string): string {
  return `${PROFILE_SESSION_PARTITION_PREFIX}${profileId}`;
}
