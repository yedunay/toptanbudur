-- Ham SQL objeleri (Prisma üretemez) — tablolardan ÖNCE
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

--

-- ==== Prisma tarafından üretilen şema ====
-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('STARTER', 'GROWTH', 'PRO');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "SupplierAuthType" AS ENUM ('NONE', 'BASIC', 'BEARER');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('STANDARD', 'ADMIN_DISCOUNT');

-- CreateEnum
CREATE TYPE "InvoiceBatchStatus" AS ENUM ('frozen', 'invoiced', 'cancelled');

-- CreateEnum
CREATE TYPE "AuditLogCategory" AS ENUM ('ADMIN', 'BIRFATURA', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('awaiting_payment', 'paid', 'preparing', 'shipped', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "FormType" AS ENUM ('CONTACT', 'APPLICATION', 'CALLBACK', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('NEW', 'HANDLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SupportMessageStatus" AS ENUM ('NEW', 'READ', 'REPLIED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReturnFlowStatus" AS ENUM ('REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'REJECTED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('SUPPORT', 'DEALER_RETURN_ORDER');

-- CreateEnum
CREATE TYPE "ConversationSenderType" AS ENUM ('CUSTOMER', 'ADMIN', 'DEALER_BUYER', 'DEALER_SELLER');

-- CreateEnum
CREATE TYPE "CariTopupStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CariLedgerType" AS ENUM ('TOPUP', 'ORDER_PAYMENT', 'REFUND', 'ADJUSTMENT', 'INTEGRATION_PAYMENT');

-- CreateEnum
CREATE TYPE "SupplierLedgerType" AS ENUM ('MANUAL_SET', 'TOPUP', 'ORDER_PURCHASE', 'ORDER_REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PopupPosition" AS ENUM ('CENTER', 'TOP', 'BOTTOM', 'TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT');

-- CreateEnum
CREATE TYPE "PopupSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- CreateEnum
CREATE TYPE "PopupFrequency" AS ENUM ('ONCE', 'EVERY_LOGIN', 'LIMITED');

-- CreateEnum
CREATE TYPE "PopupAudience" AS ENUM ('ALL', 'SEGMENT', 'SPECIFIC');

-- CreateEnum
CREATE TYPE "FinanceExpenseKind" AS ENUM ('RECURRING', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "FinanceExpenseStatus" AS ENUM ('PAID', 'UNPAID');

-- CreateEnum
CREATE TYPE "FinanceEntryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'STARTER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'OWNER',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "otpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "profilePhotoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPagePermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPagePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profitMargin" DECIMAL(10,4) NOT NULL DEFAULT 20,
    "profitType" TEXT NOT NULL DEFAULT 'fixed',
    "profitTiers" JSONB,
    "stockThreshold" INTEGER NOT NULL DEFAULT 0,
    "marketplaces" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "includeInOwnFeed" BOOLEAN NOT NULL DEFAULT true,
    "categoriesSyncedAt" TIMESTAMP(3),
    "mandatoryCarriers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresPdf" BOOLEAN NOT NULL DEFAULT false,
    "pttavmEnabled" BOOLEAN NOT NULL DEFAULT false,
    "leadTimeDays" INTEGER,
    "priceIncludesVat" BOOLEAN NOT NULL DEFAULT false,
    "extraCostTry" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "minPrice" DECIMAL(12,2) NOT NULL DEFAULT 1.0,
    "purchaseVatRate" INTEGER NOT NULL DEFAULT 20,
    "purchaseDiscountInclVatPct" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "purchaseDiscountTl" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "purchaseExtraCostTl" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "purchaseDiscountExclVatPct" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierFeed" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Ana Feed',
    "feedUrl" TEXT NOT NULL,
    "encryptedApiKey" TEXT,
    "authType" "SupplierAuthType" NOT NULL DEFAULT 'NONE',
    "authCredentialsEncrypted" TEXT,
    "refreshIntervalHours" INTEGER NOT NULL DEFAULT 6,
    "feedCurrency" TEXT DEFAULT 'TRY',
    "exchangeRate" DECIMAL(10,4),
    "exchangeRateMargin" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastFeedItemCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierFeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBrandMapping" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "sourceBrandName" TEXT NOT NULL,
    "targetBrandName" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierBrandMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierTextRule" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "search" TEXT NOT NULL,
    "replacement" TEXT NOT NULL DEFAULT '',
    "applyToName" BOOLEAN NOT NULL DEFAULT true,
    "applyToDescription" BOOLEAN NOT NULL DEFAULT true,
    "caseInsensitive" BOOLEAN NOT NULL DEFAULT true,
    "wholeWord" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierTextRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCategory" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentCode" TEXT,
    "path" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "marginPercentOverride" DECIMAL(10,4),
    "extraCostTryOverride" DECIMAL(12,2),
    "profitTypeOverride" TEXT,
    "profitTiers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "feedId" TEXT,
    "categoryId" TEXT,
    "externalCode" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rawFeedName" TEXT,
    "brand" TEXT,
    "sourceBrand" TEXT,
    "model" TEXT,
    "description" TEXT,
    "rawFeedDescription" TEXT,
    "barcode" TEXT,
    "publicBarcode" TEXT,
    "internalCode" TEXT,
    "costPrice" DECIMAL(12,2) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "taxRate" DECIMAL(5,2),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "outOfStockSince" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "marketplaceListed" BOOLEAN NOT NULL DEFAULT true,
    "forceInactive" BOOLEAN NOT NULL DEFAULT false,
    "manualPrice" DECIMAL(12,2),
    "manualStock" INTEGER,
    "feedPrice" DECIMAL(12,2),
    "feedStock" INTEGER,
    "contentHash" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "xmlPartIndex" INTEGER,
    "xmlSlotPosition" INTEGER,
    "xmlPartIndexV2" INTEGER,
    "xmlSlotPositionV2" INTEGER,
    "contentNormalizedAt" TIMESTAMP(3),
    "isCanonical" BOOLEAN NOT NULL DEFAULT true,
    "isCheapestInGroup" BOOLEAN NOT NULL DEFAULT true,
    "nameKey" TEXT,
    "canonicalCategoryPath" TEXT,
    "matchGroupId" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMatchGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "displayProductId" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'medium_name',
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "source" TEXT NOT NULL DEFAULT 'auto',
    "note" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMatchGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'paid',
    "total" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2),
    "kdvAmount" DECIMAL(12,2),
    "kdvRate" INTEGER DEFAULT 20,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "humanOrderNo" TEXT NOT NULL,
    "marketplace" TEXT,
    "cargoCompany" TEXT,
    "cargoBarcode" TEXT,
    "basitKargoOrderId" TEXT,
    "basitKargoStatus" TEXT,
    "supplierOrderNo" TEXT,
    "endCustomerName" TEXT,
    "paymentType" TEXT,
    "posProviderKey" TEXT,
    "cardCommissionRate" DECIMAL(5,2),
    "cardCommissionAmount" DECIMAL(12,2),
    "cardCommissionRateActual" DECIMAL(5,2),
    "cardCommissionAmountActual" DECIMAL(12,2),
    "cariApprovalStatus" TEXT,
    "promoBalanceApplied" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pdfUrl" TEXT,
    "pdfKey" TEXT,
    "pdfPurgedAt" TIMESTAMP(3),
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressCity" TEXT NOT NULL,
    "addressPostal" TEXT NOT NULL,
    "addressCountry" TEXT NOT NULL DEFAULT 'TR',
    "trackingNumber" TEXT,
    "notes" TEXT,
    "dispatchRoutingNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "invoiceHoldUntil" TIMESTAMP(3),
    "invoicedAt" TIMESTAMP(3),
    "billingHold" BOOLEAN NOT NULL DEFAULT false,
    "billingNote" TEXT,
    "invoiceUrl" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "invoiceBatchId" TEXT,
    "billingName" TEXT,
    "billingCompanyTitle" TEXT,
    "billingVergiNo" TEXT,
    "billingVergiDairesi" TEXT,
    "billingTcNo" TEXT,
    "billingEmail" TEXT,
    "billingPhone" TEXT,
    "billingMobilePhone" TEXT,
    "billingAddressLine" TEXT,
    "billingDistrict" TEXT,
    "billingCity" TEXT,
    "billingPostal" TEXT,
    "shippingDistrict" TEXT,
    "cargoCost" DECIMAL(12,2),
    "packagingCost" DECIMAL(12,2),
    "packagingUnitFee" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "statusChangedAt" TIMESTAMP(3),
    "lastStatusPollAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "hasHouseStockItems" BOOLEAN NOT NULL DEFAULT false,
    "houseStockDispatchedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTrackingEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "birfaturaOrderId" BIGINT NOT NULL DEFAULT nextval('birfatura_order_id_seq'::regclass),
    "orderCode" TEXT NOT NULL,
    "status" "InvoiceBatchStatus" NOT NULL DEFAULT 'frozen',
    "billingName" TEXT,
    "billingCompanyTitle" TEXT,
    "billingVergiNo" TEXT,
    "billingVergiDairesi" TEXT,
    "billingTcNo" TEXT,
    "billingEmail" TEXT,
    "billingPhone" TEXT,
    "billingMobilePhone" TEXT,
    "billingAddressLine" TEXT,
    "billingDistrict" TEXT,
    "billingCity" TEXT,
    "billingPostal" TEXT,
    "productsTotalTaxExcluding" DECIMAL(14,4) NOT NULL,
    "productsTotalTaxIncluding" DECIMAL(14,4) NOT NULL,
    "totalPaidTaxExcluding" DECIMAL(14,4) NOT NULL,
    "totalPaidTaxIncluding" DECIMAL(14,4) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'order',
    "lineDescription" TEXT,
    "invoiceUrl" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "invoicedAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "encryptedPassword" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "birthDate" TEXT,
    "language" TEXT NOT NULL DEFAULT 'tr',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "companyTitle" TEXT,
    "vergiNo" TEXT,
    "vergiDairesi" TEXT,
    "tcKimlik" TEXT,
    "mersisNumber" TEXT,
    "companyAddress" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "profitDiscountPercent" INTEGER NOT NULL DEFAULT 0,
    "customerStatus" "CustomerStatus" NOT NULL DEFAULT 'STANDARD',
    "segment" TEXT,
    "promoExpenseExempt" BOOLEAN NOT NULL DEFAULT false,
    "cariBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "xmlToken" TEXT,
    "xmlTokenV2" TEXT,
    "xmlTokenV3" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordResetTokenHash" TEXT,
    "passwordResetExpiresAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "vacationMode" BOOLEAN NOT NULL DEFAULT false,
    "vacationStartedAt" TIMESTAMP(3),
    "invoicingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "orderConfirmEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "orderStatusEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bayiNo" TEXT DEFAULT ('BAYI-'::text || lpad((nextval('bayi_no_seq'::regclass))::text, 6, '0')),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'TR',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealerApplication" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "company" TEXT,
    "message" TEXT,
    "vergiNo" TEXT,
    "vergiDairesi" TEXT,
    "package" TEXT,
    "hasIntegration" TEXT,
    "integrationSoftware" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dealer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dealer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSupplierDiscount" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "profitDiscountPercent" INTEGER NOT NULL DEFAULT 0,
    "adminDiscount" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSupplierDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "metadata" JSONB,
    "logCategory" "AuditLogCategory" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLogSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "emails" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditLogSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "minValue" DECIMAL(12,4),
    "maxValue" DECIMAL(12,4),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SecretSetting" (
    "key" TEXT NOT NULL,
    "sealedValue" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SecretSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "productSlug" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "unitPriceOriginal" DECIMAL(12,2),
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "qty" INTEGER NOT NULL,
    "costPriceSnapshot" DECIMAL(12,4),
    "supplierSku" TEXT,
    "supplierBarcode" TEXT,
    "supplierIdOverride" TEXT,
    "supplierIdSnapshot" TEXT,
    "supplierNameSnapshot" TEXT,
    "internalCodeSnapshot" TEXT,
    "publicBarcodeSnapshot" TEXT,
    "supplierSkuOverride" TEXT,
    "supplierBarcodeOverride" TEXT,
    "supplierOrderNo" TEXT,
    "houseStockReservedQty" INTEGER NOT NULL DEFAULT 0,
    "houseStockReservedUntil" TIMESTAMP(3),
    "houseStockReservedOwnerId" TEXT,
    "houseStockItemId" TEXT,
    "houseStockDispatchedAt" TIMESTAMP(3),
    "houseStockDispatchedByUserId" TEXT,
    "houseStockDispatchKind" TEXT,
    "fulfillmentSource" TEXT NOT NULL DEFAULT 'supplier',
    "fulfillingDealerId" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form" (
    "id" TEXT NOT NULL,
    "type" "FormType" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "company" TEXT,
    "vergiNo" TEXT,
    "vergiDairesi" TEXT,
    "integrationSoftware" TEXT,
    "hasIntegration" TEXT,
    "package" TEXT,
    "contractDealershipAt" TIMESTAMP(3),
    "contractPrivacyAt" TIMESTAMP(3),
    "contractDistanceAt" TIMESTAMP(3),
    "consentIp" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "gclid" TEXT,
    "referrer" TEXT,
    "landingPage" TEXT,
    "status" "FormStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "SupportMessageStatus" NOT NULL DEFAULT 'NEW',
    "adminNote" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "kind" TEXT DEFAULT 'general',
    "category" TEXT,
    "marketplace" TEXT,
    "carrier" TEXT,
    "trackingCode" TEXT,
    "returnStatus" "ReturnFlowStatus",
    "returnInvoiceKey" TEXT,
    "returnInvoiceName" TEXT,
    "returnInvoiceUploadedAt" TIMESTAMP(3),
    "returnAddress" TEXT,
    "returnDecidedAt" TIMESTAMP(3),
    "returnDecidedById" TEXT,
    "returnShippedAt" TIMESTAMP(3),
    "returnFinalizedAt" TIMESTAMP(3),

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessageAttachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "SupportMessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL,
    "supportTicketId" TEXT,
    "orderId" TEXT,
    "buyerCustomerId" TEXT,
    "sellerCustomerId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderType" "ConversationSenderType" NOT NULL,
    "senderCustomerId" TEXT,
    "senderUserId" TEXT,
    "body" TEXT NOT NULL,
    "readByAdminAt" TIMESTAMP(3),
    "readByCounterpartyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "ad" TEXT NOT NULL,
    "telefon" TEXT NOT NULL,
    "eposta" TEXT,
    "mesaj" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CariPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CariPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CariTopup" (
    "id" TEXT NOT NULL,
    "humanTopupNo" TEXT,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'bank_transfer',
    "commissionRate" DECIMAL(5,2),
    "commissionAmount" DECIMAL(12,2),
    "chargedAmount" DECIMAL(12,2),
    "status" "CariTopupStatus" NOT NULL DEFAULT 'PENDING',
    "bankAccountId" TEXT,
    "customerNote" TEXT,
    "adminNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CariTopup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CariLedger" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "CariLedgerType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "topupId" TEXT,
    "orderId" TEXT,
    "description" TEXT,
    "isPromo" BOOLEAN NOT NULL DEFAULT false,
    "isGift" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CariLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "threshold" DECIMAL(12,2) NOT NULL DEFAULT 1000,
    "lowBalanceNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierAccountLedger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "SupplierLedgerType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "orderId" TEXT,
    "humanOrderNo" TEXT,
    "description" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierAccountLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "branchCode" TEXT,
    "accountNo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosProvider" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "commissionRate" DECIMAL(5,2),
    "customerCommissionRate" DECIMAL(5,2),
    "valorDays" INTEGER,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "noInstallment" BOOLEAN NOT NULL DEFAULT false,
    "maxInstallment" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'order',
    "orderId" TEXT,
    "topupId" TEXT,
    "customerId" TEXT,
    "providerKey" TEXT NOT NULL,
    "merchantOid" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "amount" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'TL',
    "paymentType" TEXT,
    "failedReasonCode" TEXT,
    "failedReasonMsg" TEXT,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "callbackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "humanReceiptNo" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orderId" TEXT,
    "topupId" TEXT,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "posProviderKey" TEXT,
    "bayiAdi" TEXT NOT NULL,
    "bayiId" TEXT NOT NULL,
    "kartSahibi" TEXT NOT NULL,
    "aciklama" TEXT NOT NULL,
    "durum" TEXT NOT NULL DEFAULT 'Onaylandı',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdfUrl" TEXT,
    "pdfKey" TEXT,
    "pdfPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "otpSession" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminTrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminTrustedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channels" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId","type")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'pdf',
    "cron" TEXT NOT NULL,
    "recipients" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "params" JSONB,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseStockItem" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "tbdrCode" TEXT NOT NULL,
    "productName" TEXT,
    "productImage" TEXT,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseStockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseStockSettings" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "vacationMode" BOOLEAN NOT NULL DEFAULT false,
    "vacationOnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseStockSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseStockSalesLog" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseStockSalesLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Popup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "content" JSONB,
    "mediaKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mediaPurgedAt" TIMESTAMP(3),
    "imageUrl" TEXT,
    "imageKey" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "ctaNewTab" BOOLEAN NOT NULL DEFAULT true,
    "position" "PopupPosition" NOT NULL DEFAULT 'CENTER',
    "size" "PopupSize" NOT NULL DEFAULT 'MEDIUM',
    "widthPx" INTEGER,
    "backgroundColor" TEXT,
    "frequency" "PopupFrequency" NOT NULL DEFAULT 'ONCE',
    "showLimit" INTEGER NOT NULL DEFAULT 1,
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "audience" "PopupAudience" NOT NULL DEFAULT 'ALL',
    "segment" TEXT,
    "customerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "themeColor" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Popup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PopupImpression" (
    "id" TEXT NOT NULL,
    "popupId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "seenCount" INTEGER NOT NULL DEFAULT 0,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "clicked" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PopupImpression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePartner" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initials" TEXT,
    "colorHex" TEXT,
    "sharePercent" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancePartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePartnerApiKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenSealed" TEXT NOT NULL,
    "label" TEXT,
    "createdByUserId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancePartnerApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceExpenseTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "kdvRate" INTEGER NOT NULL DEFAULT 20,
    "paidByPartnerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startMonth" TEXT NOT NULL,
    "endMonth" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceExpenseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceExpense" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "kind" "FinanceExpenseKind" NOT NULL DEFAULT 'ONE_TIME',
    "templateId" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "kdvRate" INTEGER NOT NULL DEFAULT 20,
    "status" "FinanceExpenseStatus" NOT NULL DEFAULT 'PAID',
    "paidByPartnerId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceIntegrationEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "type" "FinanceEntryType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "kdvRate" INTEGER NOT NULL DEFAULT 20,
    "category" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceIntegrationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePartnerAdvance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "advanceDate" TIMESTAMP(3) NOT NULL,
    "month" TEXT NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancePartnerAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'competitor',
    "feedUrl" TEXT,
    "priceKdvIncluded" BOOLEAN NOT NULL DEFAULT true,
    "purchaseDiscountPercent" INTEGER NOT NULL DEFAULT 0,
    "packagingFee" DECIMAL(10,2),
    "isDealerPrice" BOOLEAN NOT NULL DEFAULT false,
    "fieldMap" JSONB,
    "cleanupWords" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorProduct" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "imageUrl" TEXT,
    "productUrl" TEXT,
    "barcode" TEXT,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorMatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "competitorProductId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "matchedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheaperSupplierHint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "competitorId" TEXT,
    "theirCost" DECIMAL(12,2) NOT NULL,
    "ourCost" DECIMAL(12,2) NOT NULL,
    "savingPerUnit" DECIMAL(12,2) NOT NULL,
    "productUrl" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheaperSupplierHint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CustomerTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CustomerTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "UserPagePermission_userId_idx" ON "UserPagePermission"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPagePermission_userId_pageKey_key" ON "UserPagePermission"("userId", "pageKey");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_jti_key" ON "RefreshToken"("jti");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Supplier_tenantId_idx" ON "Supplier"("tenantId");

-- CreateIndex
CREATE INDEX "SupplierFeed_supplierId_idx" ON "SupplierFeed"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierFeed_tenantId_idx" ON "SupplierFeed"("tenantId");

-- CreateIndex
CREATE INDEX "SupplierBrandMapping_supplierId_idx" ON "SupplierBrandMapping"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBrandMapping_supplierId_sourceBrandName_key" ON "SupplierBrandMapping"("supplierId", "sourceBrandName");

-- CreateIndex
CREATE INDEX "SupplierTextRule_supplierId_idx" ON "SupplierTextRule"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierTextRule_tenantId_idx" ON "SupplierTextRule"("tenantId");

-- CreateIndex
CREATE INDEX "SupplierCategory_supplierId_idx" ON "SupplierCategory"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierCategory_supplierId_parentCode_idx" ON "SupplierCategory"("supplierId", "parentCode");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCategory_supplierId_code_key" ON "SupplierCategory"("supplierId", "code");

-- CreateIndex
CREATE INDEX "Category_tenantId_parentId_idx" ON "Category"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_tenantId_path_key" ON "Category"("tenantId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "Product_publicBarcode_key" ON "Product"("publicBarcode");

-- CreateIndex
CREATE UNIQUE INDEX "Product_internalCode_key" ON "Product"("internalCode");

-- CreateIndex
CREATE INDEX "Product_tenantId_categoryId_idx" ON "Product"("tenantId", "categoryId");

-- CreateIndex
CREATE INDEX "Product_tenantId_brand_idx" ON "Product"("tenantId", "brand");

-- CreateIndex
CREATE INDEX "Product_tenantId_supplierId_sourceBrand_idx" ON "Product"("tenantId", "supplierId", "sourceBrand");

-- CreateIndex
CREATE INDEX "Product_tenantId_price_idx" ON "Product"("tenantId", "price");

-- CreateIndex
CREATE INDEX "Product_tenantId_active_idx" ON "Product"("tenantId", "active");

-- CreateIndex
CREATE INDEX "Product_tenantId_active_xmlPartIndex_xmlSlotPosition_idx" ON "Product"("tenantId", "active", "xmlPartIndex", "xmlSlotPosition");

-- CreateIndex
CREATE INDEX "Product_tenantId_active_xmlPartIndexV2_xmlSlotPositionV2_idx" ON "Product"("tenantId", "active", "xmlPartIndexV2", "xmlSlotPositionV2");

-- CreateIndex
CREATE INDEX "Product_tenantId_isCanonical_active_idx" ON "Product"("tenantId", "isCanonical", "active");

-- CreateIndex
CREATE INDEX "Product_tenantId_isCheapestInGroup_active_idx" ON "Product"("tenantId", "isCheapestInGroup", "active");

-- CreateIndex
CREATE INDEX "Product_tenantId_nameKey_idx" ON "Product"("tenantId", "nameKey");

-- CreateIndex
CREATE INDEX "Product_tenantId_canonicalCategoryPath_idx" ON "Product"("tenantId", "canonicalCategoryPath");

-- CreateIndex
CREATE INDEX "Product_tenantId_matchGroupId_idx" ON "Product"("tenantId", "matchGroupId");

-- CreateIndex
CREATE INDEX "Product_feedId_idx" ON "Product"("feedId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_supplierId_externalCode_key" ON "Product"("tenantId", "supplierId", "externalCode");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_slug_key" ON "Product"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "ProductMatchGroup_tenantId_status_idx" ON "ProductMatchGroup"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ProductMatchGroup_tenantId_displayProductId_idx" ON "ProductMatchGroup"("tenantId", "displayProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMatchGroup_tenantId_matchKey_key" ON "ProductMatchGroup"("tenantId", "matchKey");

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_humanOrderNo_key" ON "Order"("humanOrderNo");

-- CreateIndex
CREATE INDEX "Order_tenantId_status_idx" ON "Order"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_status_paidAt_idx" ON "Order"("status", "paidAt");

-- CreateIndex
CREATE INDEX "Order_invoicedAt_idx" ON "Order"("invoicedAt");

-- CreateIndex
CREATE INDEX "Order_invoiceBatchId_idx" ON "Order"("invoiceBatchId");

-- CreateIndex
CREATE INDEX "Order_status_shippedAt_invoiceBatchId_idx" ON "Order"("status", "shippedAt", "invoiceBatchId");

-- CreateIndex
CREATE INDEX "Order_status_statusChangedAt_lastStatusPollAt_idx" ON "Order"("status", "statusChangedAt", "lastStatusPollAt");

-- CreateIndex
CREATE INDEX "Order_tenantId_hasHouseStockItems_status_idx" ON "Order"("tenantId", "hasHouseStockItems", "status");

-- CreateIndex
CREATE INDEX "Order_basitKargoOrderId_idx" ON "Order"("basitKargoOrderId");

-- CreateIndex
CREATE INDEX "OrderTrackingEvent_orderId_idx" ON "OrderTrackingEvent"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceBatch_birfaturaOrderId_key" ON "InvoiceBatch"("birfaturaOrderId");

-- CreateIndex
CREATE INDEX "InvoiceBatch_status_periodEnd_idx" ON "InvoiceBatch"("status", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceBatch_customerId_paymentType_periodEnd_key" ON "InvoiceBatch"("customerId", "paymentType", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_xmlToken_key" ON "Customer"("xmlToken");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_xmlTokenV2_key" ON "Customer"("xmlTokenV2");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_xmlTokenV3_key" ON "Customer"("xmlTokenV3");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_passwordResetTokenHash_key" ON "Customer"("passwordResetTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_bayiNo_key" ON "Customer"("bayiNo");

-- CreateIndex
CREATE INDEX "CustomerTag_tenantId_idx" ON "CustomerTag"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerTag_tenantId_name_key" ON "CustomerTag"("tenantId", "name");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_isDefault_idx" ON "CustomerAddress"("customerId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "DealerApplication_email_key" ON "DealerApplication"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Dealer_email_key" ON "Dealer"("email");

-- CreateIndex
CREATE INDEX "Dealer_tenantId_idx" ON "Dealer"("tenantId");

-- CreateIndex
CREATE INDEX "CustomerSupplierDiscount_customerId_idx" ON "CustomerSupplierDiscount"("customerId");

-- CreateIndex
CREATE INDEX "CustomerSupplierDiscount_supplierId_idx" ON "CustomerSupplierDiscount"("supplierId");

-- CreateIndex
CREATE INDEX "CustomerSupplierDiscount_tenantId_idx" ON "CustomerSupplierDiscount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSupplierDiscount_customerId_supplierId_key" ON "CustomerSupplierDiscount"("customerId", "supplierId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_logCategory_createdAt_idx" ON "AuditLog"("logCategory", "createdAt");

-- CreateIndex
CREATE INDEX "AppSetting_category_idx" ON "AppSetting"("category");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_supplierIdOverride_idx" ON "OrderItem"("supplierIdOverride");

-- CreateIndex
CREATE INDEX "OrderItem_supplierIdSnapshot_idx" ON "OrderItem"("supplierIdSnapshot");

-- CreateIndex
CREATE INDEX "OrderItem_fulfillmentSource_idx" ON "OrderItem"("fulfillmentSource");

-- CreateIndex
CREATE INDEX "OrderItem_houseStockReservedUntil_idx" ON "OrderItem"("houseStockReservedUntil");

-- CreateIndex
CREATE INDEX "OrderItem_houseStockDispatchedAt_idx" ON "OrderItem"("houseStockDispatchedAt");

-- CreateIndex
CREATE INDEX "OrderItem_houseStockReservedOwnerId_idx" ON "OrderItem"("houseStockReservedOwnerId");

-- CreateIndex
CREATE INDEX "OrderItem_houseStockItemId_idx" ON "OrderItem"("houseStockItemId");

-- CreateIndex
CREATE INDEX "Form_type_status_createdAt_idx" ON "Form"("type", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_status_createdAt_idx" ON "SupportMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_email_idx" ON "SupportMessage"("email");

-- CreateIndex
CREATE INDEX "SupportMessage_customerId_createdAt_idx" ON "SupportMessage"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_orderId_createdAt_idx" ON "SupportMessage"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_kind_status_createdAt_idx" ON "SupportMessage"("kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessageAttachment_ticketId_idx" ON "SupportMessageAttachment"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_supportTicketId_key" ON "Conversation"("supportTicketId");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_type_lastMessageAt_idx" ON "Conversation"("tenantId", "type", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_orderId_idx" ON "Conversation"("orderId");

-- CreateIndex
CREATE INDEX "Conversation_buyerCustomerId_idx" ON "Conversation"("buyerCustomerId");

-- CreateIndex
CREATE INDEX "Conversation_sellerCustomerId_idx" ON "Conversation"("sellerCustomerId");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessageAttachment_messageId_idx" ON "ConversationMessageAttachment"("messageId");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CariPayment_orderId_key" ON "CariPayment"("orderId");

-- CreateIndex
CREATE INDEX "CariPayment_customerId_idx" ON "CariPayment"("customerId");

-- CreateIndex
CREATE INDEX "CariPayment_status_requestedAt_idx" ON "CariPayment"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CariTopup_humanTopupNo_key" ON "CariTopup"("humanTopupNo");

-- CreateIndex
CREATE INDEX "CariTopup_customerId_idx" ON "CariTopup"("customerId");

-- CreateIndex
CREATE INDEX "CariTopup_status_requestedAt_idx" ON "CariTopup"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CariLedger_topupId_key" ON "CariLedger"("topupId");

-- CreateIndex
CREATE INDEX "CariLedger_customerId_createdAt_idx" ON "CariLedger"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CariLedger_type_createdAt_idx" ON "CariLedger"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierAccount_supplierId_key" ON "SupplierAccount"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierAccount_tenantId_idx" ON "SupplierAccount"("tenantId");

-- CreateIndex
CREATE INDEX "SupplierAccountLedger_supplierId_createdAt_idx" ON "SupplierAccountLedger"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierAccountLedger_tenantId_createdAt_idx" ON "SupplierAccountLedger"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierAccountLedger_type_createdAt_idx" ON "SupplierAccountLedger"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierAccountLedger_orderId_supplierId_type_key" ON "SupplierAccountLedger"("orderId", "supplierId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_iban_key" ON "BankAccount"("iban");

-- CreateIndex
CREATE INDEX "BankAccount_active_position_idx" ON "BankAccount"("active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PosProvider_key_key" ON "PosProvider"("key");

-- CreateIndex
CREATE INDEX "PosProvider_active_idx" ON "PosProvider"("active");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_merchantOid_key" ON "PaymentTransaction"("merchantOid");

-- CreateIndex
CREATE INDEX "PaymentTransaction_orderId_idx" ON "PaymentTransaction"("orderId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_topupId_idx" ON "PaymentTransaction"("topupId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_customerId_idx" ON "PaymentTransaction"("customerId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_providerKey_status_createdAt_idx" ON "PaymentTransaction"("providerKey", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReceipt_humanReceiptNo_key" ON "PaymentReceipt"("humanReceiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReceipt_orderId_key" ON "PaymentReceipt"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReceipt_topupId_key" ON "PaymentReceipt"("topupId");

-- CreateIndex
CREATE INDEX "PaymentReceipt_tenantId_kind_issuedAt_idx" ON "PaymentReceipt"("tenantId", "kind", "issuedAt");

-- CreateIndex
CREATE INDEX "PaymentReceipt_customerId_issuedAt_idx" ON "PaymentReceipt"("customerId", "issuedAt");

-- CreateIndex
CREATE INDEX "PaymentReceipt_issuedAt_idx" ON "PaymentReceipt"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminOtp_otpSession_key" ON "AdminOtp"("otpSession");

-- CreateIndex
CREATE INDEX "AdminOtp_userId_idx" ON "AdminOtp"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminTrustedDevice_tokenHash_key" ON "AdminTrustedDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminTrustedDevice_userId_idx" ON "AdminTrustedDevice"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_role_readAt_createdAt_idx" ON "Notification"("role", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_type_createdAt_idx" ON "Notification"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "ReportSchedule_enabled_idx" ON "ReportSchedule"("enabled");

-- CreateIndex
CREATE INDEX "ReportSchedule_reportType_idx" ON "ReportSchedule"("reportType");

-- CreateIndex
CREATE INDEX "HouseStockItem_tbdrCode_idx" ON "HouseStockItem"("tbdrCode");

-- CreateIndex
CREATE INDEX "HouseStockItem_ownerId_stockQty_idx" ON "HouseStockItem"("ownerId", "stockQty");

-- CreateIndex
CREATE UNIQUE INDEX "HouseStockItem_ownerId_tbdrCode_key" ON "HouseStockItem"("ownerId", "tbdrCode");

-- CreateIndex
CREATE UNIQUE INDEX "HouseStockSettings_ownerId_key" ON "HouseStockSettings"("ownerId");

-- CreateIndex
CREATE INDEX "HouseStockSalesLog_ownerId_dispatchedAt_idx" ON "HouseStockSalesLog"("ownerId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "HouseStockSalesLog_orderId_idx" ON "HouseStockSalesLog"("orderId");

-- CreateIndex
CREATE INDEX "Popup_tenantId_isActive_idx" ON "Popup"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "Popup_tenantId_startsAt_endsAt_idx" ON "Popup"("tenantId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "PopupImpression_customerId_idx" ON "PopupImpression"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PopupImpression_popupId_customerId_key" ON "PopupImpression"("popupId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePartner_userId_key" ON "FinancePartner"("userId");

-- CreateIndex
CREATE INDEX "FinancePartner_tenantId_idx" ON "FinancePartner"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePartnerApiKey_tokenHash_key" ON "FinancePartnerApiKey"("tokenHash");

-- CreateIndex
CREATE INDEX "FinancePartnerApiKey_partnerId_idx" ON "FinancePartnerApiKey"("partnerId");

-- CreateIndex
CREATE INDEX "FinancePartnerApiKey_tenantId_idx" ON "FinancePartnerApiKey"("tenantId");

-- CreateIndex
CREATE INDEX "FinanceExpenseTemplate_tenantId_isActive_idx" ON "FinanceExpenseTemplate"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "FinanceExpense_tenantId_month_idx" ON "FinanceExpense"("tenantId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceExpense_tenantId_month_templateId_key" ON "FinanceExpense"("tenantId", "month", "templateId");

-- CreateIndex
CREATE INDEX "FinanceIntegrationEntry_tenantId_month_idx" ON "FinanceIntegrationEntry"("tenantId", "month");

-- CreateIndex
CREATE INDEX "FinancePartnerAdvance_tenantId_partnerId_idx" ON "FinancePartnerAdvance"("tenantId", "partnerId");

-- CreateIndex
CREATE INDEX "FinancePartnerAdvance_tenantId_month_idx" ON "FinancePartnerAdvance"("tenantId", "month");

-- CreateIndex
CREATE INDEX "Competitor_tenantId_idx" ON "Competitor"("tenantId");

-- CreateIndex
CREATE INDEX "CompetitorProduct_tenantId_idx" ON "CompetitorProduct"("tenantId");

-- CreateIndex
CREATE INDEX "CompetitorProduct_competitorId_idx" ON "CompetitorProduct"("competitorId");

-- CreateIndex
CREATE INDEX "CompetitorProduct_barcode_idx" ON "CompetitorProduct"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorProduct_competitorId_externalCode_key" ON "CompetitorProduct"("competitorId", "externalCode");

-- CreateIndex
CREATE INDEX "CompetitorMatch_tenantId_idx" ON "CompetitorMatch"("tenantId");

-- CreateIndex
CREATE INDEX "CompetitorMatch_productId_idx" ON "CompetitorMatch"("productId");

-- CreateIndex
CREATE INDEX "CompetitorMatch_status_idx" ON "CompetitorMatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorMatch_competitorProductId_productId_key" ON "CompetitorMatch"("competitorProductId", "productId");

-- CreateIndex
CREATE INDEX "CheaperSupplierHint_tenantId_idx" ON "CheaperSupplierHint"("tenantId");

-- CreateIndex
CREATE INDEX "CheaperSupplierHint_productId_idx" ON "CheaperSupplierHint"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "CheaperSupplierHint_tenantId_productId_key" ON "CheaperSupplierHint"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "_CustomerTags_B_index" ON "_CustomerTags"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPagePermission" ADD CONSTRAINT "UserPagePermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFeed" ADD CONSTRAINT "SupplierFeed_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBrandMapping" ADD CONSTRAINT "SupplierBrandMapping_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierTextRule" ADD CONSTRAINT "SupplierTextRule_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCategory" ADD CONSTRAINT "SupplierCategory_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "SupplierFeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_matchGroupId_fkey" FOREIGN KEY ("matchGroupId") REFERENCES "ProductMatchGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_invoiceBatchId_fkey" FOREIGN KEY ("invoiceBatchId") REFERENCES "InvoiceBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTrackingEvent" ADD CONSTRAINT "OrderTrackingEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceBatch" ADD CONSTRAINT "InvoiceBatch_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dealer" ADD CONSTRAINT "Dealer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSupplierDiscount" ADD CONSTRAINT "CustomerSupplierDiscount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSupplierDiscount" ADD CONSTRAINT "CustomerSupplierDiscount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_supplierIdOverride_fkey" FOREIGN KEY ("supplierIdOverride") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_houseStockReservedOwnerId_fkey" FOREIGN KEY ("houseStockReservedOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_houseStockItemId_fkey" FOREIGN KEY ("houseStockItemId") REFERENCES "HouseStockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessageAttachment" ADD CONSTRAINT "SupportMessageAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessageAttachment" ADD CONSTRAINT "ConversationMessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ConversationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CariPayment" ADD CONSTRAINT "CariPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CariPayment" ADD CONSTRAINT "CariPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CariPayment" ADD CONSTRAINT "CariPayment_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CariTopup" ADD CONSTRAINT "CariTopup_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CariTopup" ADD CONSTRAINT "CariTopup_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CariTopup" ADD CONSTRAINT "CariTopup_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CariLedger" ADD CONSTRAINT "CariLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CariLedger" ADD CONSTRAINT "CariLedger_topupId_fkey" FOREIGN KEY ("topupId") REFERENCES "CariTopup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CariLedger" ADD CONSTRAINT "CariLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CariLedger" ADD CONSTRAINT "CariLedger_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAccount" ADD CONSTRAINT "SupplierAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAccount" ADD CONSTRAINT "SupplierAccount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAccountLedger" ADD CONSTRAINT "SupplierAccountLedger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAccountLedger" ADD CONSTRAINT "SupplierAccountLedger_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAccountLedger" ADD CONSTRAINT "SupplierAccountLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SupplierAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAccountLedger" ADD CONSTRAINT "SupplierAccountLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAccountLedger" ADD CONSTRAINT "SupplierAccountLedger_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_topupId_fkey" FOREIGN KEY ("topupId") REFERENCES "CariTopup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_topupId_fkey" FOREIGN KEY ("topupId") REFERENCES "CariTopup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminOtp" ADD CONSTRAINT "AdminOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminTrustedDevice" ADD CONSTRAINT "AdminTrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseStockItem" ADD CONSTRAINT "HouseStockItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseStockSettings" ADD CONSTRAINT "HouseStockSettings_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseStockSalesLog" ADD CONSTRAINT "HouseStockSalesLog_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseStockSalesLog" ADD CONSTRAINT "HouseStockSalesLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupImpression" ADD CONSTRAINT "PopupImpression_popupId_fkey" FOREIGN KEY ("popupId") REFERENCES "Popup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupImpression" ADD CONSTRAINT "PopupImpression_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePartner" ADD CONSTRAINT "FinancePartner_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePartner" ADD CONSTRAINT "FinancePartner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePartnerApiKey" ADD CONSTRAINT "FinancePartnerApiKey_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FinancePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceExpenseTemplate" ADD CONSTRAINT "FinanceExpenseTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceExpenseTemplate" ADD CONSTRAINT "FinanceExpenseTemplate_paidByPartnerId_fkey" FOREIGN KEY ("paidByPartnerId") REFERENCES "FinancePartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FinanceExpenseTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_paidByPartnerId_fkey" FOREIGN KEY ("paidByPartnerId") REFERENCES "FinancePartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceIntegrationEntry" ADD CONSTRAINT "FinanceIntegrationEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePartnerAdvance" ADD CONSTRAINT "FinancePartnerAdvance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePartnerAdvance" ADD CONSTRAINT "FinancePartnerAdvance_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FinancePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorProduct" ADD CONSTRAINT "CompetitorProduct_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorMatch" ADD CONSTRAINT "CompetitorMatch_competitorProductId_fkey" FOREIGN KEY ("competitorProductId") REFERENCES "CompetitorProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CustomerTags" ADD CONSTRAINT "_CustomerTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CustomerTags" ADD CONSTRAINT "_CustomerTags_B_fkey" FOREIGN KEY ("B") REFERENCES "CustomerTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ham SQL objeleri (Prisma üretemez) — tablolardan SONRA
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
