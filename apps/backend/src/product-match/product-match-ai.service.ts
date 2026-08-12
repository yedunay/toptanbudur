import { Injectable, Logger } from '@nestjs/common';

/**
 * Vitrin/Satın-Alma — belirsiz (deterministik anahtarla eşleşemeyen) ürün
 * adaylarını yapay zekâ (Anthropic) ile "aynı ürün mü?" diye karara bağlar.
 *
 * Deterministik motor (product-match-key.ts) zaten kesin eşleşenleri (EAN+isim,
 * sadece-EAN aynı imza, %100 aynı isim) otomatik birleştirir. AI yalnızca
 * RESIDUAL şüphelileri çözer (aynı marka + aynı model imzası ama isim/barkod
 * deterministik tutmadı) → katalogda çift kalan sayısı minimuma iner.
 *
 * GÜVENLİK: model imzası (numara + Pro/Max/Plus/...) çağrı ÖNCESİ bucket'ta
 * zaten eşit; AI'ye yalnızca isim varyasyonu kaldığı için 13 Pro ≠ 13 Pro Max
 * gibi hatalar yapısal olarak engellidir. Yine de prompt'ta açıkça uyarılır.
 *
 * Maliyet: ANTHROPIC_API_KEY yoksa servis NO-OP'tur (deterministik motor tek
 * başına çalışır). Toplu (batch) sorgu + haiku (ucuz) kullanılır.
 */
@Injectable()
export class ProductMatchAiService {
  private readonly logger = new Logger(ProductMatchAiService.name);

  private readonly apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  private readonly model =
    process.env.PRODUCT_MATCH_AI_MODEL || 'claude-haiku-4-5';
  private readonly endpoint = 'https://api.anthropic.com/v1/messages';

  isEnabled(): boolean {
    return this.apiKey.trim().length > 0;
  }

  /**
   * Bir grup adayı için "hangileri AYNI ürün" kararını verir. items: aynı marka
   * + aynı model imzasına sahip, farklı tedarikçilerden ürünler. Dönüş: aynı
   * ürün olan id kümeleri (cluster). Sadece YÜKSEK güvenli kümeler döner.
   */
  async clusterSameProducts(
    items: ReadonlyArray<{ id: string; supplier: string; name: string }>,
  ): Promise<string[][]> {
    if (!this.isEnabled() || items.length < 2) return [];

    const list = items
      .map((p, i) => `${i + 1}. [${p.supplier}] ${p.name}`)
      .join('\n');

    const system =
      'Aynı fiziksel ürünü farklı tedarikçilerden eşleştiren bir uzmansın. ' +
      'Telefon kılıfı/aksesuar isimleri verilir; bazılarında başta "Marka" ' +
      'öneki, İphone/iPhone (p) farkı, küçük yazım/harf farkları olabilir ama ' +
      'ürün aynıdır. KESİN KURAL: model/numara farklıysa (13 Pro ≠ 13 Pro Max, ' +
      'A9 ≠ A11, Smart 9 ≠ Hot 50i) ve RENK farklıysa AYNI sayma. ' +
      'Yalnız %100 emin olduğun aynılıkları grupla.';

    const userMsg =
      `Aşağıdaki ürünlerden AYNI fiziksel ürün olanları grupla.\n\n${list}\n\n` +
      'Sadece JSON döndür: {"groups": [[1,2],[4,5]]} — her iç dizi aynı ürünün ' +
      '1-tabanlı satır numaraları. Tek başına kalanları yazma. Emin değilsen grupla ma.';

    try {
      const res = await this.callAnthropic(system, userMsg);
      const parsed = this.parseGroups(res);
      const clusters: string[][] = [];
      for (const grp of parsed) {
        const ids = grp
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length)
          .map((n) => items[n - 1].id);
        const uniq = [...new Set(ids)];
        // En az 2 FARKLI tedarikçi içermeli (aynı tedarikçi içi dedup bizim işimiz değil).
        const suppliers = new Set(
          uniq.map((id) => items.find((x) => x.id === id)?.supplier),
        );
        if (uniq.length >= 2 && suppliers.size >= 2) clusters.push(uniq);
      }
      return clusters;
    } catch (e) {
      this.logger.warn(
        `product-match AI cluster failed: ${(e as Error).message}`,
      );
      return [];
    }
  }

  private async callAnthropic(system: string, user: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      }
      const data: unknown = await resp.json();
      const blocks =
        (data as { content?: Array<{ type: string; text?: string }> })
          .content ?? [];
      return blocks
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('');
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Yanıt metninden {"groups": [[...]]} JSON'unu güvenli ayıkla. */
  private parseGroups(text: string): number[][] {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return [];
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as {
        groups?: unknown;
      };
      if (!Array.isArray(obj.groups)) return [];
      return obj.groups
        .filter((g): g is number[] => Array.isArray(g))
        .map((g) => g.map((n) => Number(n)).filter((n) => Number.isFinite(n)));
    } catch {
      return [];
    }
  }
}
