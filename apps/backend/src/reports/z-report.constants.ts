/**
 * Günlük Z raporu — sabitler.
 *
 * Her gece 00:00 (Europe/Istanbul) bir önceki günün iş özetini OWNER/ADMIN
 * kullanıcılara mail atan job'ın yapılandırması.
 */

/** BullMQ kuyruğu adı — `queue.module.ts` ile aynı string. */
export const Z_REPORT_QUEUE = 'z-report';

/** Kuyruğa eklenen job'ın adı. */
export const Z_REPORT_JOB = 'daily';

/** Repeatable job'a sabit jobId — duplicate scheduler kaydını önler. */
export const Z_REPORT_REPEAT_JOB_ID = 'z-report:daily';

/** Varsayılan cron — her gece 00:00. saniye-dakika-saat-gün-ay-haftagünü. */
export const Z_REPORT_DEFAULT_CRON = '0 0 0 * * *';

/** Rapor dönemi ve cron'un yorumlandığı saat dilimi. */
export const Z_REPORT_TIMEZONE = 'Europe/Istanbul';

/**
 * Europe/Istanbul UTC ofseti (dakika). Türkiye 2016'dan beri sabit UTC+3,
 * DST uygulamıyor — bu yüzden sabit değer güvenli.
 */
export const Z_REPORT_TIMEZONE_OFFSET_MIN = 180;

/** Mail gövdesinde gösterilecek en fazla tedarikçi satırı. */
export const Z_REPORT_TOP_SUPPLIERS = 5;

/** CSV ekinde Excel-TR uyumu için kolon ayıracı. */
export const CSV_SEPARATOR = ';';

/** CSV'nin Excel'de UTF-8 olarak açılması için BOM. */
export const CSV_BOM = '﻿';
