import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { SecretsService } from '../secrets/secrets.service';

/**
 * BirFatura'nın HTTP header'da gönderdiği token'ı doğrular.
 *
 * Token kaynağı: önce SecretsService (DB'deki AES-256-GCM sealed kayıt),
 * yoksa ConfigService (env). Her ikisi de yoksa erişim reddedilir.
 *
 * Karşılaştırma `timingSafeEqual` ile yapılır — uzunluk dahi sabit zamanlı
 * karşılaştırılır.
 */
@Injectable()
export class BirfaturaTokenGuard implements CanActivate {
  private readonly logger = new Logger(BirfaturaTokenGuard.name);

  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();

    const headerName = (
      this.config.get<string>('BIRFATURA_TOKEN_HEADER') ?? 'token'
    ).toLowerCase();

    const expected = await this.secrets.get('birfatura.apiToken');

    if (!expected) {
      this.logger.error('BirFatura token not configured (DB or env)');
      throw new ForbiddenException({ error: 'Access forbidden' });
    }

    const raw = req.headers[headerName];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!provided) {
      throw new ForbiddenException({ error: 'Access forbidden' });
    }

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
      throw new ForbiddenException({ error: 'Access forbidden' });
    }
    if (!crypto.timingSafeEqual(a, b)) {
      throw new ForbiddenException({ error: 'Access forbidden' });
    }

    return true;
  }
}
