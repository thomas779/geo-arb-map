export const PROFILE_KEY = 'geo-arb-profile';
export const LEGACY_FLAGS_KEY = 'geo-arb-flags';

type RemovableStorage = Pick<Storage, 'removeItem'>;

export function clearStoredProfile(storage: RemovableStorage): void {
  storage.removeItem(PROFILE_KEY);
  storage.removeItem(LEGACY_FLAGS_KEY);
}

