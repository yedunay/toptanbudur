import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaytrService } from '../paytr/paytr.service';
import { PAYTR_PROVIDER_KEY } from '../paytr/paytr.constants';
import { ToslaService } from '../tosla/tosla.service';
import { TOSLA_PROVIDER_KEY } from '../tosla/tosla.constants';

/**
 * Sağlayıcı-bağımsız kart ödeme dağıtıcısı.
 *
 * Frontend tek bir uca (`/payments/card/token`, `/payments/card/topup-token`)
 * istek atar; burada AKTİF PosProvider'a göre doğru sağlayıcı servisine
 * yönlendirilir (PayTR veya TOSLA). Her servis aynı şekilli `data` döndürür
 * (token, iframeUrl, merchantOid, amount, provider...). Böylece admin'den
 * "Aktif Yap" ile sağlayıcı değiştirildiğinde frontend hiç değişmeden çalışır.
 *
 * PayTR kodu DEĞİŞMEZ — yalnızca bu ince katman eklenir.
 */
@Injectable()
export class CardPaymentService {
  private readonly logger = new Logger(CardPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paytr: PaytrService,
    private readonly tosla: ToslaService,
  ) {}

  private async activeProviderKey(): Promise<string | null> {
    const provider = await this.prisma.posProvider.findFirst({
      where: { active: true },
      select: { key: true },
    });
    return provider?.key ?? null;
  }

  async createOrderToken(params: {
    orderId: string;
    receiptToken?: string;
    customerId?: string;
    userIp: string;
  }) {
    const key = await this.activeProviderKey();
    if (key === PAYTR_PROVIDER_KEY) {
      return this.paytr.createIframeToken(params);
    }
    if (key === TOSLA_PROVIDER_KEY) {
      return this.tosla.createOrderCardSession(params);
    }
    throw new ServiceUnavailableException(
      'Kartlı ödeme şu anda kullanılamıyor — lütfen daha sonra tekrar deneyin.',
    );
  }

  async createTopupToken(params: {
    topupId: string;
    customerId: string;
    userIp: string;
  }) {
    const key = await this.activeProviderKey();
    if (key === PAYTR_PROVIDER_KEY) {
      return this.paytr.createTopupIframeToken(params);
    }
    if (key === TOSLA_PROVIDER_KEY) {
      return this.tosla.createTopupCardSession(params);
    }
    throw new ServiceUnavailableException(
      'Kart ile yükleme şu anda kullanılamıyor — lütfen daha sonra tekrar deneyin.',
    );
  }
}
