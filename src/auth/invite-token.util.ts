import crypto from 'crypto';

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex'); // 64 chars
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
