import { readRealmAvatar } from '@kuroko/contracts/realms';

export const avatarFormats = 'image/jpeg,image/png,image/webp';
export const avatarFileByteLimit = 20 * 1024 * 1024;

export async function toRealmAvatar(file: Blob) {
  if ((file.type && !avatarFormats.split(',').includes(file.type)) || file.size > avatarFileByteLimit) {
    throw new Error('Invalid avatar file');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not resize avatar');
    const longestSide = Math.max(bitmap.width, bitmap.height);
    const sizes = new Set([Math.min(longestSide, 512), Math.min(longestSide, 384), Math.min(longestSide, 256)]);
    for (const size of sizes) {
      const scale = size / longestSide;
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.8, 0.65, 0.48]) {
        const avatar = canvas.toDataURL('image/webp', quality);
        if (readRealmAvatar(avatar)) return avatar;
      }
    }
    const avatar = canvas.toDataURL('image/jpeg', 0.65);
    if (readRealmAvatar(avatar)) return avatar;
    throw new Error('Could not encode avatar');
  } finally {
    bitmap.close();
  }
}
