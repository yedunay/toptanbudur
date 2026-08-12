import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../vault/vault.service';

export interface SecretMeta {
  key: string;
  label: string;
  description: string;
  envKey: string;
  /// Varsayılan true: set() çağrısı .env dosyasına da yansıtır + process.env
  /// günceller. envMirror=false ise yalnızca Vault şifreli DB'de tutulur;
  /// .env'e yazılmaz, process.env'e set edilmez. Vault okuması get() üzerinden
  /// senkron + cache'lidir, runtime'da yeterli.
  envMirror?: boolean;
}

export const SECRET_REGISTRY: Record<string, SecretMeta> = {
  'birfatura.apiToken': {
    key: 'birfatura.apiToken',
    label: 'BirFatura API Token',
    description:
      'BirFatura panelinde "API Şifresi" alanına yapıştırılan GUID. Hem DB\'ye AES-256-GCM ile şifreli yazılır hem de .env dosyasına yansıtılır.',
    envKey: 'BIRFATURA_API_TOKEN',
    envMirror: true,
  },
  // PayTR API Entegrasyon Bilgileri — PayTR Mağaza Paneli > Destek & Kurulum >
  // Entegrasyon Bilgileri sayfasından alınır. Üçü birlikte iFrame token, callback
  // hash doğrulaması ve rapor servislerinde kullanılır (paytr.client.ts).
  'paytr.merchantId': {
    key: 'paytr.merchantId',
    label: 'PayTR Mağaza No (merchant_id)',
    description:
      'PayTR Mağaza Paneli > Destek & Kurulum > Entegrasyon Bilgileri sayfasındaki Mağaza No.',
    envKey: 'PAYTR_MERCHANT_ID',
    envMirror: true,
  },
  'paytr.merchantKey': {
    key: 'paytr.merchantKey',
    label: 'PayTR Mağaza Parola (merchant_key)',
    description:
      'PayTR Entegrasyon Bilgileri sayfasındaki Mağaza Parola. AES-256-GCM ile şifreli saklanır.',
    envKey: 'PAYTR_MERCHANT_KEY',
    envMirror: true,
  },
  'paytr.merchantSalt': {
    key: 'paytr.merchantSalt',
    label: 'PayTR Mağaza Gizli Anahtar (merchant_salt)',
    description:
      'PayTR Entegrasyon Bilgileri sayfasındaki Mağaza Gizli Anahtar. AES-256-GCM ile şifreli saklanır.',
    envKey: 'PAYTR_MERCHANT_SALT',
    envMirror: true,
  },
  // TOSLA İşim (AKÖDE) API Bilgileri — TOSLA Üye İşyeri Paneli > İşyeri
  // Bilgileri > API Bilgileri sayfasından (SMS ile gelir). Üçü birlikte hash
  // üretimi, threeDPayment ve callback doğrulamasında kullanılır (tosla.client.ts).
  'tosla.clientId': {
    key: 'tosla.clientId',
    label: 'TOSLA Client ID (clientId)',
    description:
      'TOSLA API müşteri numaranız (clientId). Test ortamı için 1000000494; üretim değeri entegrasyon sonrası TOSLA tarafından verilir. AES-256-GCM ile şifreli saklanır.',
    envKey: 'TOSLA_CLIENT_ID',
    envMirror: true,
  },
  'tosla.apiUser': {
    key: 'tosla.apiUser',
    label: 'TOSLA API Kullanıcı (apiUser)',
    description:
      'TOSLA API kullanıcı adınız (apiUser). AES-256-GCM ile şifreli saklanır.',
    envKey: 'TOSLA_API_USER',
    envMirror: true,
  },
  'tosla.apiPass': {
    key: 'tosla.apiPass',
    label: 'TOSLA API Parola (apiPass)',
    description:
      'TOSLA API parolanız (apiPass) — hash üretiminde kullanılır. AES-256-GCM ile şifreli saklanır.',
    envKey: 'TOSLA_API_PASS',
    envMirror: true,
  },
};

interface ActorRef {
  id?: string | null;
  email?: string | null;
}

@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);
  private readonly memCache = new Map<string, { value: string; until: number }>();
  private readonly TTL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
    private readonly config: ConfigService,
  ) {}

  async get(key: string): Promise<string | null> {
    const cached = this.memCache.get(key);
    if (cached && cached.until > Date.now()) {
      return cached.value;
    }

    const row = await this.prisma.secretSetting.findUnique({ where: { key } });
    if (row) {
      try {
        const plaintext = this.vault.open(row.sealedValue);
        this.memCache.set(key, { value: plaintext, until: Date.now() + this.TTL_MS });
        return plaintext;
      } catch (err) {
        this.logger.error(`Failed to open sealed secret ${key}`, err as Error);
      }
    }

    const meta = SECRET_REGISTRY[key];
    // envMirror=false anahtarlar .env'e hiç yazılmaz, fallback aramaya da gerek yok.
    if (meta && meta.envMirror !== false) {
      const envVal = this.config.get<string>(meta.envKey);
      if (envVal && envVal.length > 0) {
        return envVal;
      }
    }
    return null;
  }

  async isConfigured(key: string): Promise<boolean> {
    const v = await this.get(key);
    return !!(v && v.length > 0);
  }

  async getMasked(key: string): Promise<string | null> {
    const v = await this.get(key);
    if (!v) return null;
    if (v.length <= 8) return '••••';
    return `${v.slice(0, 4)}••••${v.slice(-4)}`;
  }

  async set(key: string, plaintext: string, actor: ActorRef): Promise<void> {
    const meta = SECRET_REGISTRY[key];
    if (!meta) {
      throw new Error(`Unknown secret key: ${key}`);
    }
    const trimmed = plaintext.trim();
    if (!trimmed) {
      throw new Error('Secret value cannot be empty');
    }

    const sealed = this.vault.seal(trimmed);

    await this.prisma.secretSetting.upsert({
      where: { key },
      create: {
        key,
        sealedValue: sealed,
        label: meta.label,
        description: meta.description,
        updatedBy: actor.id ?? actor.email ?? null,
      },
      update: {
        sealedValue: sealed,
        label: meta.label,
        description: meta.description,
        updatedBy: actor.id ?? actor.email ?? null,
      },
    });

    this.memCache.set(key, { value: trimmed, until: Date.now() + this.TTL_MS });

    // envMirror=false ise yalnızca Vault'ta tutulur. .env dosyasını şişirmemek
    // + disk backup'larda plaintext sızıntı riskini azaltmak için varsayılan
    // davranıştan opt-out edilebilir.
    if (meta.envMirror !== false) {
      await this.writeEnvFile(meta.envKey, trimmed).catch((err) => {
        this.logger.warn(
          `Secret stored in DB but .env write failed: ${(err as Error).message}`,
        );
      });
      process.env[meta.envKey] = trimmed;
    }
  }

  async clear(key: string, actor: ActorRef): Promise<void> {
    const meta = SECRET_REGISTRY[key];
    if (!meta) throw new Error(`Unknown secret key: ${key}`);
    await this.prisma.secretSetting.deleteMany({ where: { key } });
    this.memCache.delete(key);
    if (meta.envMirror !== false) {
      await this.writeEnvFile(meta.envKey, '').catch(() => undefined);
      delete process.env[meta.envKey];
    }
    this.logger.log(`Secret cleared: ${key} (by ${actor.email ?? actor.id ?? 'system'})`);
  }

  private async writeEnvFile(envKey: string, value: string): Promise<void> {
    const envPath = this.resolveEnvPath();
    let content = '';
    try {
      content = await fs.readFile(envPath, 'utf-8');
    } catch {
      // .env yoksa oluştur
      content = '';
    }
    const lines = content.split('\n');
    const escaped = value.includes(' ') || value.includes('#') ? `"${value}"` : value;
    const line = `${envKey}=${escaped}`;
    let replaced = false;
    const next = lines.map((l) => {
      if (l.startsWith(`${envKey}=`) || l.startsWith(`#${envKey}=`)) {
        replaced = true;
        return value ? line : `#${envKey}=`;
      }
      return l;
    });
    if (!replaced && value) {
      if (next.length > 0 && next[next.length - 1] !== '') next.push('');
      next.push(line);
    }
    await fs.writeFile(envPath, next.join('\n'), 'utf-8');
  }

  private resolveEnvPath(): string {
    const explicit = process.env.SECRETS_ENV_FILE;
    if (explicit) return path.resolve(explicit);
    return path.resolve(process.cwd(), 'apps/backend/.env');
  }
}
