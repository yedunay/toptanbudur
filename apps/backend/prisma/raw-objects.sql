-- ============================================================================
-- HAM SQL OBJELERİ — Prisma bunları schema.prisma'dan ÜRETEMEZ.
-- Migration squash edildiğinde bu blok init migration'a elle eklenir.
-- PRE  = tablolardan ÖNCE (dbgenerated DEFAULT'lar bu sequence'lara bağlı!)
-- POST = tablolardan SONRA (trigram arama indeksleri)
-- ============================================================================

-- ############################ PRE ############################
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Sipariş numarası (Order.humanOrderNo)
CREATE SEQUENCE IF NOT EXISTS "order_human_no_seq" START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;

-- Bayi numarası — Customer.bayiNo DEFAULT'u buna bağlı (tablo ÖNCESİ şart)
CREATE SEQUENCE IF NOT EXISTS "bayi_no_seq" START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;

-- Tahsilat makbuzu numarası (PaymentReceipt.humanReceiptNo)
CREATE SEQUENCE IF NOT EXISTS "makbuz_no_seq" START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;

-- Cari yükleme talebi numarası (kod tarafında da dinamik oluşturuluyor)
CREATE SEQUENCE IF NOT EXISTS "cari_topup_human_no_seq" START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;

-- BirFatura sipariş id — InvoiceBatch.birfaturaOrderId DEFAULT'u buna bağlı (tablo ÖNCESİ şart)
CREATE SEQUENCE IF NOT EXISTS "birfatura_order_id_seq"
  START WITH 9000000000
  INCREMENT BY 1
  MINVALUE 9000000000
  NO MAXVALUE
  CACHE 1;

-- ############################ POST ############################
-- Ürün arama trigram indeksleri. Prisma GIN/trgm operatörlerini modelleyemediği
-- için bunları "fazlalık" sanıp DÜŞÜREBİLİR — prod'da ASLA `migrate dev`
-- çalıştırmayın, yalnızca `migrate deploy`.
CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx" ON "Product" USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_model_trgm_idx" ON "Product" USING GIN (model gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_brand_trgm_idx" ON "Product" USING GIN (brand gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_barcode_trgm_idx" ON "Product" USING GIN (barcode gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_description_trgm_idx" ON "Product" USING GIN (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_externalCode_trgm_idx" ON "Product" USING GIN ("externalCode" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_publicBarcode_trgm_idx" ON "Product" USING GIN ("publicBarcode" gin_trgm_ops);

-- Türkçe normalize edilmiş arama (İ/I/ı, Ş/ş, Ğ/ğ, Ç/ç, Ö/ö, Ü/ü)
CREATE INDEX IF NOT EXISTS "Product_name_tr_normalized_trgm_idx" ON "Product"
  USING GIN ((LOWER(TRANSLATE("name", 'İIıŞşĞğÇçÖöÜü', 'iiissggccoouu'))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_model_tr_normalized_trgm_idx" ON "Product"
  USING GIN ((LOWER(TRANSLATE(COALESCE("model", ''), 'İIıŞşĞğÇçÖöÜü', 'iiissggccoouu'))) gin_trgm_ops);

-- NOT (bilinçli olarak TAŞINMADI — kapsam dışı özelliklere aitti):
--   integration_payment_no_seq      → entegrasyon paketi satışı (kaldırıldı)
--   MarketplaceCatalogBrand_name_trgm → pazaryeri entegrasyonu (kaldırıldı)
--   notify_bot_paid_order() + trg_bot_notify_paid_order → alım botu (kaldırıldı)
