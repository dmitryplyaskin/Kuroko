import { readRealm, realmRequestByteLimit, type Realm } from '@kuroko/contracts/realms';
import { ApiError } from '../../shared/http/api';

export async function readRealmFile(file: File): Promise<Realm> {
  if (file.size > realmRequestByteLimit) throw new ApiError(413, 'payload_too_large');
  const bytes = await file.arrayBuffer().catch(() => {
    throw new ApiError(0, 'realm_file_unreadable');
  });
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(400, 'realm_file_invalid_json');
  }
  const result = readRealm(value);
  if ('realm' in result) return result.realm;
  if (!result.field || result.field === '/specVersion') throw new ApiError(400, 'realm_file_format');
  throw new ApiError(400, result.code, result.field);
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
