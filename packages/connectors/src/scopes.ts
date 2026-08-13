import type { ConnectorCapabilities, ConnectorProvider } from './types.js';

export type ScopeProfile = 'read-only' | 'minimum' | 'relationship-sync';

const GOOGLE_READ_ONLY = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;

const GOOGLE_MINIMUM = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
] as const;

const GOOGLE_RELATIONSHIP = [
  ...GOOGLE_MINIMUM,
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;

const MICROSOFT_READ_ONLY = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Mail.ReadBasic',
] as const;

const MICROSOFT_MINIMUM = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Mail.Send',
  'Calendars.ReadWrite',
] as const;

const MICROSOFT_RELATIONSHIP = [...MICROSOFT_MINIMUM, 'Mail.ReadBasic'] as const;

export const SCOPE_PROFILES: Readonly<
  Record<ConnectorProvider, Record<ScopeProfile, readonly string[]>>
> = {
  google: {
    'read-only': GOOGLE_READ_ONLY,
    minimum: GOOGLE_MINIMUM,
    'relationship-sync': GOOGLE_RELATIONSHIP,
  },
  microsoft: {
    'read-only': MICROSOFT_READ_ONLY,
    minimum: MICROSOFT_MINIMUM,
    'relationship-sync': MICROSOFT_RELATIONSHIP,
  },
};

const READ_ONLY_CAPABILITIES: ConnectorCapabilities = {
  canReadInbox: true,
  canSyncRelationships: false,
  canDraft: false,
  canSend: false,
  canReadCalendar: false,
  canWriteCalendar: false,
};

const MINIMUM_CAPABILITIES: ConnectorCapabilities = {
  canReadInbox: false,
  canSyncRelationships: false,
  canDraft: true,
  canSend: true,
  canReadCalendar: true,
  canWriteCalendar: true,
};

const RELATIONSHIP_SYNC_CAPABILITIES: ConnectorCapabilities = {
  canReadInbox: true,
  canSyncRelationships: true,
  canDraft: true,
  canSend: true,
  canReadCalendar: true,
  canWriteCalendar: true,
};

/**
 * Provider-neutral capability summary per scope profile. The profile is the
 * persisted contract; these flags are what the desktop status exposes so
 * inbox reading (read-only) is never presented as send-ready relationship
 * sync.
 */
export const SCOPE_PROFILE_CAPABILITIES: Readonly<
  Record<ScopeProfile, ConnectorCapabilities>
> = {
  'read-only': READ_ONLY_CAPABILITIES,
  minimum: MINIMUM_CAPABILITIES,
  'relationship-sync': RELATIONSHIP_SYNC_CAPABILITIES,
};

/**
 * Extra delegated scopes needed only when a founder chooses provider-hosted
 * drafts. Local SQLite drafts and direct send do not need these broader scopes.
 */
export const PROVIDER_DRAFT_SCOPES: Readonly<Record<ConnectorProvider, readonly string[]>> = {
  google: ['https://www.googleapis.com/auth/gmail.compose'],
  microsoft: ['Mail.ReadWrite'],
};

export function getScopes(
  provider: ConnectorProvider,
  profile: ScopeProfile = 'minimum',
): string[] {
  return [...SCOPE_PROFILES[provider][profile]];
}

export function getCapabilities(profile: ScopeProfile): ConnectorCapabilities {
  return { ...SCOPE_PROFILE_CAPABILITIES[profile] };
}

/**
 * Resolves the persisted scope profile, falling back to the pre-0.2
 * relationshipSync boolean for existing vault rows. Absent configuration
 * resolves to the historical minimum (send-capable) profile so old behavior
 * is preserved; the new read-only profile is always explicit.
 */
export function resolveScopeProfile(config: {
  scopeProfile?: ScopeProfile | undefined;
  relationshipSync?: boolean | undefined;
}): ScopeProfile {
  return config.scopeProfile ?? (config.relationshipSync === true ? 'relationship-sync' : 'minimum');
}
