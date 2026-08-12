import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

interface HealthResponse {
  status: 'ok';
  timestamp: string;
  uptime: number;
  env: string;
}

interface HealthDbResponse {
  status: 'ok';
  db: 'connected';
  timestamp: string;
}

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Sağlık kontrolü — Docker healthcheck, load balancer probe, monitoring için.
  // Auth yok (global guard zaten yok), throttle bypass var ki probe'lar rate-limit
  // duvarına çarpmasın.
  @Get('health')
  @SkipThrottle()
  health(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      env: process.env.NODE_ENV ?? 'unknown',
    };
  }

  // Daha derin kontrol — DB bağlantısını da doğrular.
  @Get('health/db')
  @SkipThrottle()
  async healthDb(): Promise<HealthDbResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        db: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        db: 'disconnected',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
