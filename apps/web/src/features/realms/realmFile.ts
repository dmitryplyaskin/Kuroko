import { readRealm, realmRequestByteLimit, type Realm } from '@kuroko/contracts/realms';
import { ApiError } from '../../shared/http/api';
import { avatarFileByteLimit, toRealmAvatar } from './realmAvatarFile';
import { convertSillyTavernCard, isPng, readSillyTavernPng, type ImportLabels } from './sillyTavernCard';

export type ImportedRealm = { realm: Realm; avatarFailed?: boolean };

export async function readRealmFile(file: File, labels: ImportLabels): Promise<
  { source: 'kuroko'; realm: Realm } | ({ source: 'sillytavern' } & ImportedRealm)
> {
  if (file.size > avatarFileByteLimit) throw new ApiError(413, 'payload_too_large');
  const buffer = await file.arrayBuffer().catch(() => {
    throw new ApiError(0, 'realm_file_unreadable');
  });
  const bytes = new Uint8Array(buffer);
  if (isPng(bytes) || file.type === 'image/png' || /\.png$/i.test(file.name)) {
    const realm = readSillyTavernPng(bytes, labels);
    if (!realm) throw new ApiError(400, 'realm_file_png_card');
    const avatar = await toRealmAvatar(file.slice(0, file.size, 'image/png')).catch(() => undefined);
    if (avatar) {
      realm.avatar = avatar;
      if (realm.characters?.[0]) realm.characters[0].avatar = avatar;
    }
    return { source: 'sillytavern', realm: validateConvertedRealm(realm), avatarFailed: !avatar };
  }

  if (file.size > realmRequestByteLimit) throw new ApiError(413, 'payload_too_large');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(400, 'realm_file_invalid_json');
  }
  const result = readRealm(value);
  if ('realm' in result) return { source: 'kuroko', realm: result.realm };
  const realm = convertSillyTavernCard(value, labels);
  if (realm) return { source: 'sillytavern', realm: validateConvertedRealm(realm) };
  if (!result.field || result.field === '/specVersion') throw new ApiError(400, 'realm_file_format');
  throw new ApiError(400, result.code, result.field);
}

function validateConvertedRealm(realm: Realm) {
  const result = readRealm(realm);
  if (!('realm' in result)) throw new ApiError(400, result.code, result.field);
  if (new Blob([JSON.stringify(realm)]).size > realmRequestByteLimit) throw new ApiError(413, 'payload_too_large');
  return result.realm;
}

const jsonType = { type: 'application/json;charset=utf-8' };

function realmBlob(realm: Realm) {
  const formatted = new Blob([JSON.stringify(realm, null, 2), '\n'], jsonType);
  if (formatted.size <= realmRequestByteLimit) return formatted;
  const compact = new Blob([JSON.stringify(realm)], jsonType);
  if (compact.size > realmRequestByteLimit) throw new ApiError(413, 'payload_too_large');
  return compact;
}

export function downloadRealmFile(realm: Realm) {
  const blob = realmBlob(realm);
  const safeTitle = realm.title.trim().replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]/gu, '-');
  const name = Array.from(safeTitle).slice(0, 96).join('').replace(/[. ]+$/, '');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `realm-${name || 'card'}.json`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
