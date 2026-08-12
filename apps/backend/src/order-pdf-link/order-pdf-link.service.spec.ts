import { ConfigService } from '@nestjs/config';
import { OrderPdfLinkService } from './order-pdf-link.service';

/// Minimal stub — servis yalnız config.get() çağırır.
function makeService(overrides: Record<string, string> = {}): OrderPdfLinkService {
  const values: Record<string, string> = {
    STORAGE_HMAC_SECRET: 'test-secret',
    STORAGE_PUBLIC_BASE_URL: 'https://toptanbudur.com',
    ...overrides,
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  return new OrderPdfLinkService(config);
}

describe('OrderPdfLinkService', () => {
  it('kendi ürettiği token\'ı doğrular (round-trip)', () => {
    const svc = makeService();
    const token = svc.tokenFor('order_123');
    expect(svc.verify('order_123', token)).toBe(true);
  });

  it('token stabildir — aynı orderId hep aynı token (süresiz link)', () => {
    const svc = makeService();
    expect(svc.tokenFor('order_123')).toBe(svc.tokenFor('order_123'));
  });

  it('başka siparişin token\'ını REDDEDER (enumerate koruması)', () => {
    const svc = makeService();
    const token = svc.tokenFor('order_123');
    expect(svc.verify('order_999', token)).toBe(false);
  });

  it('bozuk/boş token\'ı reddeder', () => {
    const svc = makeService();
    expect(svc.verify('order_123', 'bozuk')).toBe(false);
    expect(svc.verify('order_123', '')).toBe(false);
  });

  it('farklı sır → farklı token (imza gerçekten sırra bağlı)', () => {
    const a = makeService({ STORAGE_HMAC_SECRET: 'secret-a' });
    const b = makeService({ STORAGE_HMAC_SECRET: 'secret-b' });
    expect(a.tokenFor('order_123')).not.toBe(b.tokenFor('order_123'));
  });

  it('mutlak kalıcı URL üretir (exp/imza YOK)', () => {
    const svc = makeService();
    const url = svc.buildUrl('order_123');
    expect(url).toBe(
      `https://toptanbudur.com/api/order-pdf/order_123/${svc.tokenFor('order_123')}`,
    );
    expect(url).not.toContain('exp=');
    expect(url).not.toContain('sig=');
  });

  it('STORAGE_PUBLIC_BASE_URL yoksa null döner (bozuk relative link göndermez)', () => {
    const svc = makeService({ STORAGE_PUBLIC_BASE_URL: '' });
    expect(svc.buildUrl('order_123')).toBeNull();
  });
});
