import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    const connectionString = config.getOrThrow<string>('DATABASE_URL');
    // VPC içi (10.0.0.2) Postgres self-signed sertifika kullanıyor.
    // @prisma/adapter-pg, sslmode=require'ı verify-full gibi davrandırdığı
    // için connection string'deki sslmode bypass'a yetmiyor; pool config
    // üzerinden açıkça rejectUnauthorized:false vermek gerekiyor.
    super({
      adapter: new PrismaPg({
        connectionString,
        ssl: { rejectUnauthorized: false },
        // Bağlantı havuzu açıkça boyutlandırıldı. Varsayılan (node-postgres) 10
        // idi; tek backend + 9 in-process worker + HTTP hepsi bu havuzu paylaşıyor.
        // DB tarafında max_connections=50 → tek backend için 20 güvenli tavan
        // (admin/psql için pay kalır). connectionTimeout: boş slot yoksa istek
        // 10sn içinde net hata alsın (sonsuz asılı kalmasın). idleTimeout: boşta
        // bağlantılar 30sn sonra bırakılsın ki spike sonrası havuz küçülsün.
        max: 20,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
