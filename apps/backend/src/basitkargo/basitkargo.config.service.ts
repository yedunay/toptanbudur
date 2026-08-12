import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppSettingsService } from '../app-settings/app-settings.service';
import {
  BASITKARGO_DEFAULTS,
  BASITKARGO_ENV_KEYS,
  BASITKARGO_SETTING_KEYS,
} from './basitkargo.constants';

/**
 * Basit Kargo runtime config — hibrit kaynak:
 *  - Secret + BASE_URL + webhook token → .env
 *  - enabled toggle / handler stratejisi / paket ölçüsü → AppSetting (admin editable)
 *
 * Hiçbir hardcoded token bu modülün dışına çıkmaz.
 */
@Injectable()
export class BasitKargoConfigService {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: AppSettingsService,
  ) {}

  getBaseUrl(): string {
    const url = this.config.get<string>(BASITKARGO_ENV_KEYS.BASE_URL);
    return ((url && url.trim()) || BASITKARGO_DEFAULTS.BASE_URL).replace(
      /\/$/,
      '',
    );
  }

  /// API token zorunlu — yoksa 503. Bootstrap'te uyarı log'lanır.
  getApiToken(): string {
    const token = this.config.get<string>(BASITKARGO_ENV_KEYS.API_TOKEN);
    if (!token || token.trim() === '') {
      throw new ServiceUnavailableException(
        `${BASITKARGO_ENV_KEYS.API_TOKEN} not configured in .env`,
      );
    }
    return token.trim();
  }

  hasApiToken(): boolean {
    const token = this.config.get<string>(BASITKARGO_ENV_KEYS.API_TOKEN);
    return !!token && token.trim().length > 0;
  }

  getWebhookToken(): string {
    return (
      this.config.get<string>(BASITKARGO_ENV_KEYS.WEBHOOK_TOKEN) ?? ''
    ).trim();
  }

  /**
   * Entegrasyon aktif mi? Token yoksa DAİMA kapalı (self siparişler eski
   * "elle bekleme" davranışında kalır). Token varsa AppSetting `enabled`
   * (default true) belirler.
   */
  async isEnabled(): Promise<boolean> {
    if (!this.hasApiToken()) return false;
    return this.settings.getBoolean(BASITKARGO_SETTING_KEYS.ENABLED, true);
  }

  /// ECONOMIC (varsayılan) / FAST / somut firma kodu (admin sabitlerse).
  async getHandlerStrategy(): Promise<string> {
    const raw = await this.settings.getString(
      BASITKARGO_SETTING_KEYS.HANDLER_STRATEGY,
      BASITKARGO_DEFAULTS.HANDLER_STRATEGY,
    );
    const up = raw.trim().toUpperCase();
    return up || BASITKARGO_DEFAULTS.HANDLER_STRATEGY;
  }

  async getDefaultPackage(): Promise<{
    height: number;
    width: number;
    depth: number;
    weight: number;
  }> {
    const [height, width, depth, weight] = await Promise.all([
      this.settings.getNumber(
        BASITKARGO_SETTING_KEYS.PACKAGE_HEIGHT,
        BASITKARGO_DEFAULTS.PACKAGE.height,
      ),
      this.settings.getNumber(
        BASITKARGO_SETTING_KEYS.PACKAGE_WIDTH,
        BASITKARGO_DEFAULTS.PACKAGE.width,
      ),
      this.settings.getNumber(
        BASITKARGO_SETTING_KEYS.PACKAGE_DEPTH,
        BASITKARGO_DEFAULTS.PACKAGE.depth,
      ),
      this.settings.getNumber(
        BASITKARGO_SETTING_KEYS.PACKAGE_WEIGHT,
        BASITKARGO_DEFAULTS.PACKAGE.weight,
      ),
    ]);
    const safe = (n: number, fb: number) =>
      Number.isFinite(n) && n > 0 ? n : fb;
    return {
      height: safe(height, BASITKARGO_DEFAULTS.PACKAGE.height),
      width: safe(width, BASITKARGO_DEFAULTS.PACKAGE.width),
      depth: safe(depth, BASITKARGO_DEFAULTS.PACKAGE.depth),
      weight: safe(weight, BASITKARGO_DEFAULTS.PACKAGE.weight),
    };
  }
}
