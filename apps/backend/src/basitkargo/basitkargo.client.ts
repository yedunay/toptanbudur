import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, isAxiosError } from 'axios';
import { z } from 'zod';
import { BasitKargoConfigService } from './basitkargo.config.service';
import { BASITKARGO_ENDPOINTS } from './basitkargo.constants';
import {
  BkCreateOrderRequest,
  BkOrder,
  bkOrderSchema,
} from './basitkargo.types';

/** Basit Kargo API hata sınıfı — status + gövde taşır (audit/log için). */
export class BasitKargoApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'BasitKargoApiError';
  }
}

/**
 * Basit Kargo REST istemcisi. Tek sorumluluk: HTTP çağrısı + parse. İş mantığı
 * (idempotency, matching, routing) BasitKargoService'te. Token .env'den okunur,
 * axios cache'lenir; config değişirse invalidateCache() ile sıfırlanır.
 */
@Injectable()
export class BasitKargoClient {
  private readonly logger = new Logger(BasitKargoClient.name);
  private axiosCache: AxiosInstance | null = null;

  constructor(private readonly config: BasitKargoConfigService) {}

  private http(): AxiosInstance {
    if (this.axiosCache) return this.axiosCache;
    this.axiosCache = axios.create({
      baseURL: this.config.getBaseUrl(),
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${this.config.getApiToken()}`,
      },
      validateStatus: () => true,
    });
    return this.axiosCache;
  }

  invalidateCache(): void {
    this.axiosCache = null;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    responseType: 'json' | 'text' = 'json',
  ): Promise<T> {
    let status = 0;
    let data: unknown = null;
    try {
      const res = await this.http().request<unknown>({
        method,
        url: path,
        data: body,
        responseType: responseType === 'text' ? 'text' : 'json',
      });
      status = res.status;
      data = res.data;
    } catch (err: unknown) {
      const msg = isAxiosError(err)
        ? err.message
        : err instanceof Error
          ? err.message
          : 'transport error';
      this.logger.error(`BasitKargo ${method} ${path} transport failure: ${msg}`);
      throw new BasitKargoApiError(`transport: ${msg}`, 0, null);
    }
    if (status < 200 || status >= 300) {
      this.logger.warn(`BasitKargo ${method} ${path} → HTTP ${status}`);
      throw new BasitKargoApiError(`HTTP ${status}`, status, data);
    }
    return data as T;
  }

  /** POST /v2/order/barcode — sipariş oluşturur + anında kargo kodu üretir. */
  async createOrderWithBarcode(req: BkCreateOrderRequest): Promise<BkOrder> {
    const raw = await this.request<unknown>(
      'POST',
      BASITKARGO_ENDPOINTS.CREATE_ORDER_BARCODE,
      req,
    );
    return bkOrderSchema.parse(raw);
  }

  /**
   * POST /v2/order/filter — tarih penceresi ile siparişleri listeler. Reconcile
   * (çift-POST önleme) için content.code eşleşmesi caller tarafında yapılır.
   * Yanıt hem düz dizi hem `{content:[...]}` sayfa şeklinde gelebilir.
   *
   * DİKKAT (canlı API doğrulaması): `sortBy` ZORUNLU — gönderilmezse endpoint
   * HTTP 500 döner. Bu yüzden burada DAİMA sortBy (default CREATED_TIME) + page
   * enjekte edilir; caller override edebilir.
   */
  async filterOrders(body: {
    startDate?: string;
    endDate?: string;
    page?: number;
    size?: number;
    sortBy?: string;
  }): Promise<BkOrder[]> {
    const raw = await this.request<unknown>(
      'POST',
      BASITKARGO_ENDPOINTS.FILTER_ORDERS,
      { sortBy: 'CREATED_TIME', page: 0, ...body },
    );
    const list = Array.isArray(raw)
      ? raw
      : ((raw as { content?: unknown })?.content ?? []);
    return z.array(bkOrderSchema).parse(Array.isArray(list) ? list : []);
  }

  /** GET /v2/order/{id} — firma + handlerShipmentCode + güncel durum. */
  async getOrder(id: string): Promise<BkOrder> {
    const raw = await this.request<unknown>(
      'GET',
      BASITKARGO_ENDPOINTS.GET_ORDER(id),
    );
    return bkOrderSchema.parse(raw);
  }

  /** DELETE /order/barcode/{barcode} — şubeye teslim edilmemiş barkodu iptal. */
  async cancelBarcode(barcode: string): Promise<void> {
    await this.request<unknown>(
      'DELETE',
      BASITKARGO_ENDPOINTS.CANCEL_BARCODE(barcode),
    );
  }

  /** GET /label/svg/{id} — etiket SVG (ham string). */
  async getLabelSvg(id: string): Promise<string> {
    return this.request<string>(
      'GET',
      BASITKARGO_ENDPOINTS.LABEL_SVG(id),
      undefined,
      'text',
    );
  }

  async listCities(): Promise<unknown> {
    return this.request<unknown>('GET', BASITKARGO_ENDPOINTS.CITIES);
  }

  async listTowns(cityId: string): Promise<unknown> {
    return this.request<unknown>('GET', BASITKARGO_ENDPOINTS.TOWNS(cityId));
  }

  async listNeighborhoods(cityName: string, townName: string): Promise<unknown> {
    return this.request<unknown>(
      'GET',
      BASITKARGO_ENDPOINTS.NEIGHBORHOODS(cityName, townName),
    );
  }

  async getBalance(): Promise<unknown> {
    return this.request<unknown>('GET', BASITKARGO_ENDPOINTS.BALANCE);
  }
}
