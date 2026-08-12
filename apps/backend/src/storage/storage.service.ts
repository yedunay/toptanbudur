import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';

/**
 * Hafif S3/MinIO PUT istemcisi — `minio` veya `@aws-sdk` bağımlılığı yok.
 * AWS SigV4 ile path-style PUT yapar (MinIO docker-compose ile aynı yerelde).
 * Bucket önceden oluşturulmuş olmalı (compose seed); bu servis sadece nesne
 * yükler ve geri çağıran için kalıcı bir nesne anahtarı üretir.
 *
 * Public görünürlük: bu servis HTTP URL döner. Bucket'ın `download` izni
 * `*` ise URL doğrudan tarayıcıdan açılır; aksi halde frontend signed-URL
 * üretmek için ayrı bir endpoint çağırmalıdır (out of scope).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly endpoint: string;
  private readonly region: string;
  private readonly bucket: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly forcePathStyle: boolean;

  constructor(config: ConfigService) {
    this.endpoint = config
      .getOrThrow<string>('S3_ENDPOINT')
      .replace(/\/+$/, '');
    this.region = config.get<string>('S3_REGION') ?? 'auto';
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.accessKey = config.getOrThrow<string>('S3_ACCESS_KEY');
    this.secretKey = config.getOrThrow<string>('S3_SECRET_KEY');
    this.forcePathStyle =
      (config.get<string>('S3_FORCE_PATH_STYLE') ?? 'true') === 'true';
  }

  /**
   * `key` örn. `order-pdfs/<orderId>/<dosya>.pdf`. Body byte buffer olmalı.
   * Geri dönüş: bucket relative public URL (`{endpoint}/{bucket}/{key}` —
   * MinIO path-style). Çağıran bunu Order.pdfUrl alanına yazar.
   */
  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ url: string; key: string }> {
    const host = new URL(this.endpoint).host;
    const path = this.forcePathStyle
      ? `/${this.bucket}/${key}`
      : `/${key}`;
    const targetHost = this.forcePathStyle
      ? host
      : `${this.bucket}.${host}`;

    const now = new Date();
    const amzDate = now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, '')
      .slice(0, 15) + 'Z';
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(body).digest('hex');
    const url = this.forcePathStyle
      ? `${this.endpoint}${path}`
      : `${new URL(this.endpoint).protocol}//${targetHost}${path}`;

    const canonicalHeaders =
      `content-type:${contentType}\n` +
      `host:${targetHost}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest =
      `PUT\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign =
      `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n` +
      createHash('sha256').update(canonicalRequest).digest('hex');

    const kDate = hmac(`AWS4${this.secretKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = hmac(kSigning, stringToSign).toString('hex');
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // The runtime `fetch` (undici) accepts Buffer/Uint8Array as body, but the
    // ambient DOM `BodyInit` type bundled with Node's typings does not list
    // them — copy into a fresh ArrayBuffer slice and cast to BodyInit. The
    // copy is unavoidable for type safety; PDFs here are <= 10 MB.
    const ab = body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as ArrayBuffer;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'content-type': contentType,
        'host': targetHost,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        'authorization': authorization,
      },
      body: ab,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(
        `S3 PUT failed status=${res.status} key=${key} body=${text.slice(0, 500)}`,
      );
      throw new InternalServerErrorException('storage upload failed');
    }
    return { url, key };
  }
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}
