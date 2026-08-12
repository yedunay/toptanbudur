import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

interface SealedPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

@Injectable()
export class VaultService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const hex = config.getOrThrow<string>('VAULT_MASTER_KEY');
    if (hex.length !== 64) {
      throw new Error('VAULT_MASTER_KEY must be 32 bytes (64 hex chars)');
    }
    this.key = Buffer.from(hex, 'hex');
  }

  seal(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const payload: SealedPayload = {
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: enc.toString('base64'),
    };
    return JSON.stringify(payload);
  }

  open(sealed: string): string {
    const payload = JSON.parse(sealed) as SealedPayload;
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const ct = Buffer.from(payload.ciphertext, 'base64');
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return dec.toString('utf8');
  }
}
