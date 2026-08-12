/**
 * normalization-bootstrap.service.ts
 *
 * Runs once on every application startup (onApplicationBootstrap).
 * Finds all products where contentNormalizedAt IS NULL and normalises them
 * in batches. Sets contentNormalizedAt after each successful batch so that
 * a crash mid-run is safe — the next startup resumes from where it left off.
 *
 * After a product is normalized its name/description/barcode/model are frozen
 * permanently; ingest will never overwrite them again.
 *
 * On a fully-normalized database this service exits immediately with a single
 * COUNT query — zero performance impact on subsequent startups.
 */

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  normalizeProductName,
  normalizeProductDescription,
} from './product-normalizer';

const BATCH_SIZE = 500;

@Injectable()
export class NormalizationBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NormalizationBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    // Fire-and-forget — never block app startup
    void this.runIfNeeded();
  }

  private async runIfNeeded(): Promise<void> {
    const pending = await this.prisma.product.count({
      where: { contentNormalizedAt: null },
    });

    if (pending > 0) {
      this.logger.log(
        `Content normalization: ${pending} products pending — starting background normalization.`,
      );
      await this.normalizeAll(pending);
    } else {
      this.logger.log('Content normalization: all products already normalized.');
    }
  }

  private async normalizeAll(total: number): Promise<void> {
    let processed = 0;
    let cursor: string | undefined;

    for (;;) {
      const batch = await this.prisma.product.findMany({
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        where: { contentNormalizedAt: null },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
        },
      });

      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;

      await this.prisma.$transaction(
        batch.map((p) =>
          this.prisma.product.update({
            where: { id: p.id },
            data: {
              name: normalizeProductName(p.name),
              description: normalizeProductDescription(p.description),
              contentNormalizedAt: new Date(),
            },
          }),
        ),
        // Each update is independent — no need for serializability
        { isolationLevel: 'ReadCommitted', timeout: 60_000 },
      );

      processed += batch.length;
      this.logger.log(
        `Content normalization: ${processed} / ${total} products done.`,
      );
    }

    this.logger.log('Content normalization: completed successfully.');
  }
}
