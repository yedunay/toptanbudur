import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { PrismaService } from '../prisma/prisma.service';
import { stripCleanup, fold } from './comparison-match.util';

interface FieldMap {
  item?: string; // ürün düğümü tag'i (ör. "product"); boşsa otomatik bulunur
  name?: string;
  price?: string;
  barcode?: string;
  code?: string; // externalCode kaynağı (yoksa barcode/index)
  image?: string;
  stock?: string;
  url?: string; // rakip ürün sayfası linki (ör. "link" veya "url")
}

/**
 * Rakip/tedarikçi XML feed'ini çeker, parse eder, CompetitorProduct'a upsert eder.
 * SADECE kendi tablosuna yazar. Alan eşlemesi (fieldMap) + önek temizleme
 * (cleanupWords → normalizedName) uygular. Sabit anahtar: (competitorId, externalCode).
 */
@Injectable()
export class ComparisonIngestService {
  private readonly log = new Logger('ComparisonIngest');
  constructor(private readonly prisma: PrismaService) {}

  private pick(obj: any, path?: string): string {
    if (!path) return '';
    const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
    if (v == null) return '';
    if (Array.isArray(v)) return v.length ? String(v[0]).trim() : ''; // nested (ör. images.image) → ilk
    return String(v).trim();
  }

  /** fieldMap'te açık eşleme varsa onu; yoksa yaygın tag adaylarını sırayla dener. */
  private pickFirst(obj: any, explicit: string | undefined, fallbacks: string[]): string {
    if (explicit) return this.pick(obj, explicit);
    for (const f of fallbacks) {
      const v = this.pick(obj, f);
      if (v) return v;
    }
    return '';
  }

  /**
   * Fiyat parse — hem TR (1.234,56) hem US (1,234.56) formatı + binlik ayraçlı
   * tamsayı (1.140 / 1,140 = 1140). Kural: iki ayraç varsa SON gelen ondalıktır;
   * tek ayraç + son grup 3 haneyse binlik ayraçtır (1.140 → 1140).
   * "1,140.00 TRY" → 1140 · "1.140,00" → 1140 · "150.00" → 150 · "150,00" → 150.
   */
  private parsePrice(raw: string): number {
    if (!raw) return NaN;
    let s = raw.replace(/[^0-9.,]/g, ''); // para birimi/harf/boşluk at
    if (!s) return NaN;
    const hasDot = s.includes('.'), hasComma = s.includes(',');
    if (hasDot && hasComma) {
      if (s.lastIndexOf('.') > s.lastIndexOf(',')) s = s.replace(/,/g, ''); // US: nokta ondalık
      else s = s.replace(/\./g, '').replace(',', '.'); // TR: virgül ondalık
    } else if (hasComma) {
      const p = s.split(',');
      const decimal = p.length === 2 && (p[1].length !== 3 || p[0] === '0');
      s = decimal ? `${p[0]}.${p[1]}` : p.join('');
    } else if (hasDot) {
      const p = s.split('.');
      const decimal = p.length === 2 && (p[1].length !== 3 || p[0] === '0');
      s = decimal ? `${p[0]}.${p[1]}` : p.join('');
    }
    return Number(s);
  }

  /** Parse edilmiş ağaçtan ürün dizisini bulur (fieldMap.item veya en büyük obje dizisi). */
  private findItems(root: any, itemTag?: string): any[] {
    if (itemTag) {
      let found: any[] = [];
      const walk = (o: any) => {
        if (o == null || typeof o !== 'object') return;
        for (const [k, v] of Object.entries(o)) {
          if (k === itemTag) found = Array.isArray(v) ? v : [v];
          else walk(v);
        }
      };
      walk(root);
      if (found.length) return found;
    }
    // otomatik: en büyük "obje dizisi"ni bul
    let best: any[] = [];
    const walk = (o: any) => {
      if (o == null || typeof o !== 'object') return;
      if (Array.isArray(o)) {
        if (o.length > best.length && typeof o[0] === 'object') best = o;
        o.forEach(walk);
      } else Object.values(o).forEach(walk);
    };
    walk(root);
    return best;
  }

  /** Feed'i çekip parse eder, ürünleri upsert eder. Döner: {total, upserted}. */
  async ingest(competitorId: string, tenantId: string): Promise<{ total: number; upserted: number }> {
    const comp = await this.prisma.competitor.findFirst({ where: { id: competitorId, tenantId } });
    if (!comp || !comp.feedUrl) return { total: 0, upserted: 0 };
    const fmap = (comp.fieldMap as FieldMap) ?? {};
    const cleanup = (comp.cleanupWords as string[]) ?? [];

    const resp = await axios.get<string>(comp.feedUrl, {
      responseType: 'text',
      timeout: 60000,
      maxContentLength: 200 * 1024 * 1024,
      headers: { 'User-Agent': 'ToptanBudur-Comparisons/1.0' },
    });
    const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
    const items = this.findItems(parser.parse(resp.data), fmap.item);

    // satırları topla (feed-içi dup externalCode ele)
    const rows: any[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const name = this.pickFirst(it, fmap.name, ['name', 'title', 'urun_adi', 'productName', 'ad', 'baslik']);
      if (!name) continue;
      const price = this.parsePrice(this.pickFirst(it, fmap.price, ['price', 'g:price', 'salePrice', 'g:sale_price', 'buyPrice', 'satisFiyati', 'fiyat', 'listPrice', 'listprice']));
      if (!Number.isFinite(price) || price <= 0) continue;
      const barcode = this.pickFirst(it, fmap.barcode, ['barcode', 'barkod', 'gtin', 'g:gtin', 'ean']) || null;
      const externalCode = this.pickFirst(it, fmap.code, ['productCode', 'id', 'g:id', 'stockCode', 'sku', 'model', 'model_number']) || barcode || `idx-${i}`;
      if (seen.has(externalCode)) continue;
      seen.add(externalCode);
      const { cleaned } = stripCleanup(name, cleanup);
      const normalizedName = fold(cleaned);
      const stock = Number(this.pickFirst(it, fmap.stock, ['quantity', 'stock', 'stok', 'adet', 'g:quantity']).replace(/[^0-9]/g, '')) || 0;
      const imageUrl = this.pickFirst(it, fmap.image, ['image1', 'image_link', 'g:image_link', 'image', 'resim', 'picture']) || null;
      const productUrl = this.pickFirst(it, fmap.url, ['link', 'url', 'g:link']) || null;
      rows.push({ tenantId, competitorId, externalCode, name, normalizedName, price, imageUrl, productUrl, barcode, stock, lastSeenAt: new Date() });
    }

    let upserted = 0;
    const existing = await this.prisma.competitorProduct.count({ where: { competitorId } });
    if (existing === 0) {
      // İLK sync → hızlı batch (createMany). Büyük feed'de per-row upsert timeout'unu önler.
      for (let i = 0; i < rows.length; i += 1000) {
        const r = await this.prisma.competitorProduct.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true });
        upserted += r.count;
      }
    } else {
      // Yeniden sync → upsert (fiyat/stok güncelle, eşleşmeleri koru)
      for (const row of rows) {
        await this.prisma.competitorProduct.upsert({
          where: { competitorId_externalCode: { competitorId, externalCode: row.externalCode } },
          create: row,
          update: { name: row.name, normalizedName: row.normalizedName, price: row.price, imageUrl: row.imageUrl, productUrl: row.productUrl, barcode: row.barcode, stock: row.stock, active: true, lastSeenAt: row.lastSeenAt },
        });
        upserted++;
      }
    }
    await this.prisma.competitor.update({ where: { id: competitorId }, data: { lastSyncedAt: new Date() } });
    this.log.log(`ingest ${comp.name}: ${items.length} bulundu, ${upserted} upsert`);
    return { total: items.length, upserted };
  }
}
