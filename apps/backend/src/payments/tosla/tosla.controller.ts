import { Body, Controller, Post, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { randomBytes } from 'crypto';
import type { Response } from 'express';
import { ToslaService } from './tosla.service';
import type { ToslaCallbackPost } from './tosla.client';

@Controller('payments/tosla')
export class ToslaController {
  constructor(private readonly tosla: ToslaService) {}

  /**
   * TOSLA Callback URL — ortak ödeme sayfası 3D sonucunu (tarayıcı, iframe
   * içinde) buraya POST eder (application/x-www-form-urlencoded).
   *
   * KURALLAR:
   *  - Guard/throttle yok (TOSLA/banka yönlendirmesiyle gelir).
   *  - Hash doğrulanmadan HİÇBİR işlem onaylanmaz (maddi güvenlik).
   *  - Yanıt: iframe'den çıkıp (window.top) sonuç sayfasına yönlendiren HTML.
   *
   * TOSLA Üye İşyeri Paneli'nde Bildirim/Callback URL:
   *   https://toptanbudur.com/api/payments/tosla/callback  (HTTPS)
   */
  @SkipThrottle({ short: true, medium: true, default: true })
  @Post('callback')
  async callback(
    @Body() body: ToslaCallbackPost,
    @Res() res: Response,
  ): Promise<void> {
    let redirectUrl = '/';
    try {
      const result = await this.tosla.handleCallback(body ?? {});
      redirectUrl = result.redirectUrl;
    } catch {
      // İşleme hatası olsa bile kullanıcıyı iframe'de bırakma — ana sayfaya çıkar.
      redirectUrl = '/';
    }
    const safe = JSON.stringify(redirectUrl);
    // KRİTİK: Helmet'in global CSP'si (script-src 'self') inline script'i
    // engeller → iframe'den çıkış (window.top) çalışmaz, kullanıcı "işleniyor"
    // ekranında takılır. Bu yanıta ÖZEL, nonce'lu CSP ile yalnızca bu redirect
    // script'ine izin ver (içerik tamamen bizim; redirectUrl JSON-encoded → XSS yok).
    const nonce = randomBytes(16).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'`,
    );
    // Iframe'den çık (window.top) ve sonuç sayfasına yönlendir.
    const html =
      '<!doctype html><html lang="tr"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Ödeme sonucu</title></head><body style="font-family:system-ui;text-align:center;padding:40px">' +
      '<p>Ödeme sonucu işleniyor, yönlendiriliyorsunuz…</p>' +
      '<script nonce="' +
      nonce +
      '">(function(){var u=' +
      safe +
      ';try{window.top.location.href=u;}catch(e){window.location.href=u;}})();</script>' +
      '<noscript><a href=' +
      safe +
      '>Devam etmek için tıklayın</a></noscript>' +
      '</body></html>';
    res.status(200).type('text/html').send(html);
  }
}
