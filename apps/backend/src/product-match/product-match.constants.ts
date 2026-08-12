/**
 * Vitrin/Satın-Alma çapraz-tedarikçi eşleştirme sabitleri.
 */

export const PRODUCT_MATCH_SETTING_KEYS = {
  /**
   * Kill-switch. default TRUE — eşleştirme tam otomatik çalışır: active gruplar
   * vitrin (dedup → pahalı/TB gösterilir) ve satın-alma yönlendirmesine etki eder.
   * Bir sorun olursa AppSetting'ten false yapılarak mevcut nameKey davranışına
   * dönülür (gruplar korunur, etkisi kalkar).
   */
  ENABLED: 'product-match.enabled',
  /**
   * Eşleştirme kapsamındaki tedarikçiler — virgülle ayrılmış supplierId listesi.
   * BOŞ (varsayılan) = tenant'ın TÜM aktif tedarikçileri kapsama girer.
   */
  SCOPE_SUPPLIER_IDS: 'productmatch.scopeSupplierIds',
} as const;

export const PRODUCT_MATCH_DEFAULTS = {
  ENABLED: true,
} as const;
