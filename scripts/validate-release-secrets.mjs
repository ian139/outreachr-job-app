#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './_lib.mjs';

const MAC_SIGNING_GROUP = [
  'OUTREACHR_MAC_CERTIFICATE_BASE64',
  'OUTREACHR_MAC_CERTIFICATE_PASSWORD',
  'OUTREACHR_MAC_EXPECTED_TEAM_ID',
];
const WINDOWS_SIGNING_GROUP = [
  'OUTREACHR_WINDOWS_CERTIFICATE_BASE64',
  'OUTREACHR_WINDOWS_CERTIFICATE_PASSWORD',
  'OUTREACHR_WINDOWS_EXPECTED_PUBLISHER',
];
const API_NOTARY_GROUP = [
  'OUTREACHR_APPLE_API_KEY_BASE64',
  'OUTREACHR_APPLE_API_KEY_ID',
  'OUTREACHR_APPLE_API_ISSUER',
];
const APPLE_ID_NOTARY_GROUP = [
  'OUTREACHR_APPLE_ID',
  'OUTREACHR_APPLE_APP_SPECIFIC_PASSWORD',
  'OUTREACHR_APPLE_TEAM_ID',
];

export function assessReleaseSecrets(environment = process.env, policy = 'mac-required') {
  if (!['optional', 'required', 'mac-required', 'windows-required', 'strict'].includes(policy)) {
    throw new Error(`Unknown release-signing policy: ${policy}`);
  }

  const problems = [];
  const macSigning = groupState(MAC_SIGNING_GROUP, environment);
  const windowsSigning = groupState(WINDOWS_SIGNING_GROUP, environment);
  const apiNotary = groupState(API_NOTARY_GROUP, environment);
  const appleIdNotary = groupState(APPLE_ID_NOTARY_GROUP, environment);

  rejectPartial('macOS certificate', macSigning, problems);
  rejectPartial('Windows certificate', windowsSigning, problems);
  rejectPartial('App Store Connect notarization', apiNotary, problems);
  rejectPartial('Apple ID notarization', appleIdNotary, problems);

  if (apiNotary.state !== 'absent' && appleIdNotary.state !== 'absent') {
    problems.push(
      'Apple notarization credential modes (App Store Connect API key and Apple ID) are mutually exclusive',
    );
  }

  const hasPortableMac =
    macSigning.state !== 'absent' ||
    apiNotary.state !== 'absent' ||
    appleIdNotary.state !== 'absent';
  const hasKeychainMac =
    Boolean(environment.OUTREACHR_MAC_KEYCHAIN_IDENTITY) ||
    Boolean(environment.OUTREACHR_APPLE_KEYCHAIN_PROFILE) ||
    Boolean(environment.OUTREACHR_APPLE_KEYCHAIN);

  if (hasPortableMac && hasKeychainMac) {
    problems.push(
      'macOS portable certificate and local Keychain signing credentials are mutually exclusive',
    );
  }

  const hasCompleteNotary =
    apiNotary.state === 'complete' ||
    appleIdNotary.state === 'complete' ||
    Boolean(environment.OUTREACHR_APPLE_KEYCHAIN_PROFILE);

  if (hasPortableMac && (macSigning.state !== 'complete' || !hasCompleteNotary)) {
    problems.push(
      'macOS signing is partially configured: a complete certificate group and one complete notarization group must be supplied together',
    );
  }

  const effectiveMacRequired =
    policy === 'mac-required' || policy === 'required' || policy === 'strict';
  const effectiveWinRequired =
    policy === 'windows-required' || policy === 'required' || policy === 'strict';

  if (effectiveMacRequired && macSigning.state !== 'complete') {
    problems.push('macOS signing certificate group is required by the selected policy');
  }
  if (effectiveMacRequired && !hasCompleteNotary) {
    problems.push(
      'One complete Apple notarization credential group is required by the selected policy',
    );
  }
  if (effectiveWinRequired && windowsSigning.state !== 'complete') {
    problems.push('Windows Authenticode certificate group is required by the selected policy');
  }

  if (problems.length) {
    throw new Error(`Release signing readiness failed:\n- ${[...new Set(problems)].join('\n- ')}`);
  }

  const macSigned = macSigning.state === 'complete' && hasCompleteNotary;
  const winSigned = windowsSigning.state === 'complete';
  const mac = macSigned ? 'signed' : 'unsigned';
  const windows = winSigned ? 'signed' : 'unsigned';

  const notaryMode =
    apiNotary.state === 'complete'
      ? 'api_key'
      : appleIdNotary.state === 'complete'
        ? 'apple_id'
        : environment.OUTREACHR_APPLE_KEYCHAIN_PROFILE
          ? 'keychain_profile'
          : 'none';

  const secretMode =
    macSigning.state === 'complete' ||
    apiNotary.state === 'complete' ||
    appleIdNotary.state === 'complete'
      ? 'portable'
      : environment.OUTREACHR_MAC_KEYCHAIN_IDENTITY
        ? 'local-keychain'
        : 'none';

  const overall =
    macSigned && winSigned ? 'fully-signed' : macSigned ? 'mac-signed' : 'mixed-or-unsigned';

  return {
    policy,
    mac,
    windows,
    overall,
    notaryMode,
    secretMode,
  };
}

function groupState(names, environment) {
  const present = names.filter((name) => Boolean(environment[name]));
  return {
    state:
      present.length === 0 ? 'absent' : present.length === names.length ? 'complete' : 'partial',
  };
}

function rejectPartial(label, state, problems) {
  if (state.state === 'partial') problems.push(`${label} credential group is partial`);
}

async function main() {
  const args = parseArgs();
  const policy = String(args.policy ?? 'mac-required');
  const result = assessReleaseSecrets(process.env, policy);
  if (args.json === true || args.json === 'true') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      result.mac === 'signed'
        ? `macOS Developer ID signing and notarization credentials are complete (mode: ${result.secretMode}, notary: ${result.notaryMode}).`
        : 'macOS credentials are absent; the release will be explicitly unsigned and unnotarized.',
    );
    console.log(
      result.windows === 'signed'
        ? 'Windows Authenticode signing credentials are complete.'
        : 'Windows credentials are absent; the release will be explicitly unsigned.',
    );
  }

  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `mac_signing=${result.mac}\nwindows_signing=${result.windows}\noverall_signing=${result.overall}\nnotary_mode=${result.notaryMode}\nsecret_mode=${result.secretMode}\n`,
      'utf8',
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
