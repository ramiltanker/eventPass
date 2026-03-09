import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const secret = process.env.INVITE_TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('INVITE_TOKEN_ENCRYPTION_KEY is missing');
  }

  return createHash('sha256').update(secret).digest();
}

export function encryptInviteToken(token: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

export function decryptInviteToken(payload: string): string {
  const key = getKey();
  const [ivB64, authTagB64, encryptedB64] = payload.split('.');

  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error('Invalid encrypted invite token payload');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
