import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuditModule } from './audit/audit.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { VaultModule } from './vault/vault.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { QueueModule } from './queue/queue.module';
import { IngestModule } from './ingest/ingest.module';
import { CatalogModule } from './catalog/catalog.module';
import { AdminProductsModule } from './admin-products/admin-products.module';
import { AdminCategoriesModule } from './admin-categories/admin-categories.module';
import { OrdersModule } from './orders/orders.module';
import { CustomerAuthModule } from './customer-auth/customer-auth.module';
import { DealerModule } from './dealer/dealer.module';
import { ProductCoreModule } from './product-core/product-core.module';
import { ProductMatchModule } from './product-match/product-match.module';
import { ComparisonsModule } from './comparisons/comparisons.module';
import { AdminSuppliersModule } from './admin/suppliers/admin-suppliers.module';
import { AdminProfitabilityModule } from './admin/profitability/admin-profitability.module';
import { AdminMuhasebeModule } from './admin/muhasebe/admin-muhasebe.module';
import { AdminFinanceModule } from './admin/finance/finance.module';
import { AdminOrdersModule } from './admin/orders/admin-orders.module';
import { AdminUsersModule } from './admin/users/admin-users.module';
import { PermissionsModule } from './permissions/permissions.module';
import { AdminCustomersModule } from './admin/customers/admin-customers.module';
import { AdminAnalyticsModule } from './admin/analytics/admin-analytics.module';
import { AdminDashboardModule } from './admin/dashboard/admin-dashboard.module';
import { AdminExportsModule } from './admin/exports/admin-exports.module';
import { AdminInvoicesModule } from './admin/invoices/admin-invoices.module';
import { AdminMessagesModule } from './admin/messages/admin-messages.module';
import { AdminExchangeRateModule } from './admin/exchange-rate/admin-exchange-rate.module';
import { AdminPosModule } from './admin/pos/admin-pos.module';
import { AdminReceiptsModule } from './admin/receipts/admin-receipts.module';
import { AdminPopupsModule } from './admin/popups/admin-popups.module';
import { CustomerPopupsModule } from './customer/popups/customer-popups.module';
import { PaytrModule } from './payments/paytr/paytr.module';
import { ToslaModule } from './payments/tosla/tosla.module';
import { CardPaymentModule } from './payments/card/card-payment.module';
import { CustomerProfileModule } from './customer/profile/customer-profile.module';
import { CustomerOrdersModule } from './customer/orders/customer-orders.module';
import { CustomerOverviewModule } from './customer/overview/customer-overview.module';
import { CustomerPricingModule } from './customer/pricing/customer-pricing.module';
import { CustomerInvoicesModule } from './customer/invoices/customer-invoices.module';
import { LeadsModule } from './leads/leads.module';
import { FormsModule } from './forms/forms.module';
import { SupportMessagesModule } from './support-messages/support-messages.module';
import { ConversationsModule } from './conversations/conversations.module';
import { ExchangeRateModule } from './common/services/exchange-rate.module';
import { MailModule } from './mail/mail.module';
import { CariPaymentsModule } from './cari-payments/cari-payments.module';
import { CariBalanceModule } from './cari-balance/cari-balance.module';
import { SupplierAccountModule } from './supplier-account/supplier-account.module';
import { PartnerFinanceApiModule } from './partner-finance-api/partner-finance-api.module';
import { AdminSupplierCurrentAccountModule } from './admin/supplier-current-account/admin-supplier-current-account.module';
import { AppSettingsModule } from './app-settings/app-settings.module';
import { SecretsModule } from './secrets/secrets.module';
import { BirfaturaModule } from './birfatura/birfatura.module';
import { ReportsModule } from './reports/reports.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrderPdfLinkModule } from './order-pdf-link/order-pdf-link.module';
import { BasitKargoModule } from './basitkargo/basitkargo.module';
import { AutoShipModule } from './order-lifecycle/auto-ship.module';
import { StockReconcileModule } from './stock-reconcile/stock-reconcile.module';
import { StorageRetentionModule } from './storage-retention/storage-retention.module';
import { HouseStockModule } from './house-stock/house-stock.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * #17 — SSE (EventSource) auth token'ı query string'de geliyor
 * (`?access_token=` / `?token=`) çünkü EventSource özel HTTP header'ı
 * ekleyemiyor. Pino access log'unda tüm `req.url` yazıldığı için bu token
 * düz metin olarak log dosyasına sızıyordu. Bu yardımcı, url içindeki
 * `token` ve `access_token` query değerlerini `[REDACTED]` ile değiştirir.
 */
function redactTokenInUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  if (!url.includes('token=')) return url;
  return url.replace(
    /([?&](?:access_token|token)=)[^&#]*/gi,
    '$1[REDACTED]',
  );
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level:
          process.env.LOG_LEVEL ??
          (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname,req.headers,res.headers',
                },
              },
        // Correlate logs with the upstream request id when present, otherwise
        // mint a fresh UUID. The id is also reflected back as a response header
        // so clients/proxies can include it in bug reports.
        genReqId: (
          req: IncomingMessage,
          res: ServerResponse<IncomingMessage>,
        ) => {
          const incoming = req.headers[REQUEST_ID_HEADER];
          const id =
            (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
          res.setHeader(REQUEST_ID_HEADER, id);
          return id;
        },
        customProps: () => ({ service: 'backend' }),
        // Never write secrets/PII into log files.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["set-cookie"]',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.newPassword',
            // Dış servis API kimlik bilgileri — düz metin asla log dosyasına
            // yazılmaz. seal()'lenmeden önce request body'de taşınan
            // apiKey/apiSecret bu yollarla maskelenir.
            'req.body.apiKey',
            'req.body.apiSecret',
            'res.headers["set-cookie"]',
            // #17: SSE token'ı query string'de geldiği için ayrıca
            // `req.query.*` de maskeliyoruz (ileride serializer query'yi
            // expose ederse koruma altında olsun). Asıl url string'i
            // serializer içindeki redactTokenInUrl ile temizleniyor.
            'req.query.token',
            'req.query.access_token',
          ],
          censor: '[REDACTED]',
        },
        autoLogging: {
          ignore: (req: IncomingMessage) => {
            const url = req.url ?? '';
            // Health probes flood the log otherwise.
            return url.startsWith('/api/health') || url === '/api/health';
          },
        },
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            // #17: SSE token'ı query string'de geldiği için tüm `req.url`
            // loglanırsa token log dosyasına sızar. Pino redact yalnız
            // ayrıştırılmış `req.query`'yi maskeler, biz ise serializer'da
            // sadece `url` string'i veriyoruz — bu yüzden token'ı burada elle
            // [REDACTED] ile değiştiriyoruz (access_token + token paramları).
            url: redactTokenInUrl(req.url),
          }),
          res: (res: { statusCode: number }) => ({
            statusCode: res.statusCode,
          }),
        },
      },
    }),
    ScheduleModule.forRoot(),
    AuditModule,
    // Global throttler — yalnız hassas endpoint'ler için son savunma hattı.
    // Landing/storefront SSR aynı IP'den (docker bridge) çıkışlı kategori +
    // ürün listesi burst'ü atıyor; eski `short:10/sn medium:120/dk` limitleri
    // tek bir page render'da bile 429 üretiyordu. Public read endpoint'ler
    // (`/catalog/*`) ayrıca @SkipThrottle ile muaf tutulduğundan global eşik
    // sadece auth/forms/admin gibi yazma/giriş endpoint'lerini koruyor.
    // `default` throttler ZORUNLU: kod tabanında 32 endpoint
    // `@Throttle({ default: { ... } })` kullanıyor; global config'de bu adda
    // throttler tanımlı olmayınca NestJS bu override'ları sessizce yok sayıyor
    // (NO-OP) ve login/bakiye/cari/iade POST'larında hiç limit uygulanmıyordu.
    // `default` eklendi → tüm `@Throttle({ default })` çağrıları artık çalışır.
    // NOT: forRoot'taki TÜM isimli throttler'lar her route'a GLOBAL uygulanır.
    // 'default'u küçük tutmak (örn. 60/dk) tüm sistemi (admin panel polling,
    // PayTR webhook, storefront) o sınıra çekerdi — istenmeyen sıkılaştırma.
    // Bu yüzden global taban 'medium' ile aynı (600/dk); 'default' yalnızca
    // @Throttle({ default }) ile route bazında SIKILAŞTIRILIR (ör. login 10/dk),
    // global tarafı gevşek bırakır.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 600 },
      { name: 'short', ttl: 1000, limit: 30 },
      { name: 'medium', ttl: 60_000, limit: 600 },
    ]),
    PrismaModule,
    VaultModule,
    StorageModule,
    OrderPdfLinkModule,
    ExchangeRateModule,
    MailModule,
    AuthModule,
    QueueModule,
    IngestModule,
    StockReconcileModule,
    CatalogModule,
    AdminProductsModule,
    AdminCategoriesModule,
    OrdersModule,
    CustomerAuthModule,
    DealerModule,
    ProductCoreModule,
    ProductMatchModule,
    ComparisonsModule,
    AdminSuppliersModule,
    AdminProfitabilityModule,
    AdminMuhasebeModule,
    AdminFinanceModule,
    AdminOrdersModule,
    AdminUsersModule,
    PermissionsModule,
    AdminCustomersModule,
    AdminAnalyticsModule,
    AdminDashboardModule,
    AdminExportsModule,
    AdminInvoicesModule,
    AdminMessagesModule,
    AdminExchangeRateModule,
    AdminPosModule,
    AdminReceiptsModule,
    AdminPopupsModule,
    PaytrModule,
    ToslaModule,
    CardPaymentModule,
    CustomerProfileModule,
    CustomerOrdersModule,
    CustomerOverviewModule,
    CustomerPopupsModule,
    AdminPopupsModule,
    CustomerPricingModule,
    CustomerInvoicesModule,
    CustomerPopupsModule,
    LeadsModule,
    FormsModule,
    SupportMessagesModule,
    ConversationsModule,
    CariPaymentsModule,
    CariBalanceModule,
    SupplierAccountModule,
    PartnerFinanceApiModule,
    AdminSupplierCurrentAccountModule,
    AppSettingsModule,
    SecretsModule,
    BirfaturaModule,
    ReportsModule,
    NotificationsModule,
    BasitKargoModule,
    AutoShipModule,
    StorageRetentionModule,
    HouseStockModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
