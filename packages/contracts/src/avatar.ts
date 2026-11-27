export const avatarMaxLength = 65_536;

export function readAvatar(value: unknown) {
  if (typeof value !== 'string' || value.length > avatarMaxLength) return;
  const [matched, mime, data] = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value) ?? [];
  if (matched !== value || !mime || !data || data.length % 4 !== 0) return;
  const header = atob(data.slice(0, 16));
  const valid = mime === 'image/png' ? header.startsWith('\x89PNG\r\n\x1a\n')
    : mime === 'image/jpeg' ? header.startsWith('\xff\xd8\xff') : header.startsWith('RIFF') && header.slice(8) === 'WEBP';
  if (valid) return { mime, data };
}
