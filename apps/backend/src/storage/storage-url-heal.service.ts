import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PUBLIC_ASSET_PREFIXES,
  STORAGE_SERVICE,
} from './storage.constants';
import type { IFileStorage } from './storage.interface';

/**
 * Boot-time, idempotent repair for the "manuel ürün / profil fotoğrafı
 * görselleri bir süre sonra siliniyor" bug.
 *
 * Until this fix, the SHORT-LIVED download URL was persisted straight into
 * `ProductImage.url` / `User.profilePhotoUrl`:
 *   - local driver → `/api/storage/...?exp&sig`, expired after 10 minutes
 *   - R2 driver (live) → a 7-day presigned URL, expired after a week
 * Once `exp` passed, the URL went 403 and the image looked deleted — even
 * though the file was always intact (R2 bucket / local volume).
 *
 * The forward fix (storing the durable `getPublicUrl()` redirect route) only
 * helps NEW uploads. This service rewrites EXISTING rows — regardless of which
 * driver minted them — to the stable `/api/storage-public/<key>` form, so
 * already-broken images (e.g. the manual "365nm UV El Feneri" and profile
 * photos) start working again on the next deploy.
 *
 * Idempotent BY EQUALITY: getPublicUrl() is deterministic (no exp/sig), so a
 * second pass produces the same string and updates nothing — no churn.
 */
@Injectable()
export class StorageUrlHealService implements OnModuleInit {
  private readonly logger = new Logger(StorageUrlHealService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: IFileStorage,
  ) {}

  onModuleInit(): void {
    // Fire-and-forget — never block app boot on a maintenance pass; best-effort.
    void this.run();
  }

  private async run(): Promise<void> {
    try {
      const products = await this.healProductImages();
      const photos = await this.healProfilePhotos();
      if (products + photos > 0) {
        this.logger.log(
          `storage-url-heal: ${products} ürün görseli + ${photos} profil ` +
            `fotoğrafı kalıcı URL'e taşındı (süresi dolmuş URL onarımı)`,
        );
      }
    } catch (err) {
      this.logger.warn(`storage-url-heal atlandı: ${(err as Error).message}`);
    }
  }

  private async healProductImages(): Promise<number> {
    // Manuel ürün görselleri key'inde 'manual-products/' taşır (feed ürünleri
    // tedarikçinin dış URL'ini saklar, eşleşmez). Eski/yeni tüm URL şekillerini
    // bu substring yakalar.
    const rows = await this.prisma.productImage.findMany({
      where: { url: { contains: 'manual-products/' } },
      select: { id: true, url: true },
    });
    let healed = 0;
    for (const r of rows) {
      const fresh = await this.toDurable(r.url);
      if (!fresh || fresh === r.url) continue;
      await this.prisma.productImage.update({
        where: { id: r.id },
        data: { url: fresh },
      });
      healed++;
    }
    return healed;
  }

  private async healProfilePhotos(): Promise<number> {
    const rows = await this.prisma.user.findMany({
      where: { profilePhotoUrl: { contains: 'users/' } },
      select: { id: true, profilePhotoUrl: true },
    });
    let healed = 0;
    for (const r of rows) {
      if (!r.profilePhotoUrl) continue;
      const fresh = await this.toDurable(r.profilePhotoUrl);
      if (!fresh || fresh === r.profilePhotoUrl) continue;
      await this.prisma.user.update({
        where: { id: r.id },
        data: { profilePhotoUrl: fresh },
      });
      healed++;
    }
    return healed;
  }

  /// Bir URL'i (local imzalı / R2 presigned / zaten taşınmış) kalıcı public
  /// URL'e çevirir. Public key çıkarılamazsa null.
  private async toDurable(url: string): Promise<string | null> {
    const key = extractPublicKey(url);
    if (!key) return null;
    return this.storage.getPublicUrl(key);
  }
}

/**
 * Storage key'ini herhangi bir URL şeklinden çıkarır. Key daima bilinen bir
 * public prefix ile başlar (`manual-products/`, `users/`); URL ister local
 * imzalı (`/api/storage/...`), ister R2 presigned (host/path-style fark etmez),
 * ister zaten taşınmış (`/api/storage-public/...`) olsun, prefix'in ilk
 * geçtiği yerden query'ye kadar olan kısım key'dir.
 */
function extractPublicKey(url: string): string | null {
  if (!url) return null;
  const noQuery = url.split('?')[0];
  let best: number | null = null;
  for (const p of PUBLIC_ASSET_PREFIXES) {
    const i = noQuery.indexOf(p);
    if (i >= 0 && (best === null || i < best)) best = i;
  }
  if (best === null) return null;
  const key = noQuery.slice(best);
  return key || null;
}
