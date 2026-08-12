import { PrismaService } from '../prisma/prisma.service';
import { HouseStockService } from './house-stock.service';

/**
 * 03:00 OTO-DEVİR cron'unun çekirdek mantığını (autoTransferStalePendingToSupplier)
 * izole eder. Kritik invaryant: YALNIZCA bekleyen (status='paid' + reservedQty>0 +
 * dispatchedAt=null) kalemler devredilir; dispatch edilmiş veya paid olmayan
 * siparişlere ASLA dokunulmaz (tekrar-satın-alma riski).
 */

interface FakeOrder {
  id: string;
  status: string;
  hasHouseStockItems: boolean;
}

interface FakeItem {
  id: string;
  orderId: string;
  houseStockReservedQty: number;
  houseStockDispatchedAt: Date | null;
  houseStockReservedUntil: Date | null;
  houseStockReservedOwnerId: string | null;
  houseStockItemId: string | null;
}

interface FakeDepot {
  id: string;
  reservedQty: number;
  stockQty: number;
}

function buildPrismaMock(opts: {
  orders: FakeOrder[];
  items: FakeItem[];
  depots: FakeDepot[];
}): PrismaService {
  const { orders, items, depots } = opts;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matchOrderItemWhere = (it: FakeItem, where: any): boolean => {
    if (where.houseStockReservedQty?.gt !== undefined) {
      if (!(it.houseStockReservedQty > where.houseStockReservedQty.gt)) {
        return false;
      }
    }
    if (
      'houseStockDispatchedAt' in where &&
      where.houseStockDispatchedAt === null &&
      it.houseStockDispatchedAt !== null
    ) {
      return false;
    }
    if (where.orderId !== undefined && it.orderId !== where.orderId) {
      return false;
    }
    if (where.order?.status !== undefined) {
      const ord = orders.find((o) => o.id === it.orderId);
      if (!ord || ord.status !== where.order.status) return false;
    }
    return true;
  };

  const client = {
    orderItem: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: jest.fn((args: any) =>
        Promise.resolve(
          items
            .filter((it) => matchOrderItemWhere(it, args.where))
            .map((it) => ({ ...it })),
        ),
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count: jest.fn((args: any) =>
        Promise.resolve(
          items.filter((it) => matchOrderItemWhere(it, args.where)).length,
        ),
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: jest.fn((args: any) => {
        const target = items.find((it) => it.id === args.where.id);
        if (target) Object.assign(target, args.data);
        return Promise.resolve(target);
      }),
    },
    houseStockItem: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: jest.fn((args: any) => {
        const target = depots.find((d) => d.id === args.where.id);
        if (target && args.data.reservedQty?.decrement !== undefined) {
          target.reservedQty -= args.data.reservedQty.decrement;
        }
        if (target && args.data.reservedQty?.increment !== undefined) {
          target.reservedQty += args.data.reservedQty.increment;
        }
        return Promise.resolve(target);
      }),
      // KOŞULLU düşüm (race-safe releaseItemInTx / confirmDispatchInTx).
      // where.reservedQty.gte ve/veya where.stockQty.gte sağlanmazsa count=0.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: jest.fn((args: any) => {
        const target = depots.find((d) => d.id === args.where.id);
        if (!target) return Promise.resolve({ count: 0 });
        const needReserved = args.where.reservedQty?.gte;
        const needStock = args.where.stockQty?.gte;
        if (needReserved !== undefined && !(target.reservedQty >= needReserved)) {
          return Promise.resolve({ count: 0 });
        }
        if (needStock !== undefined && !(target.stockQty >= needStock)) {
          return Promise.resolve({ count: 0 });
        }
        if (args.data.reservedQty?.decrement !== undefined) {
          target.reservedQty -= args.data.reservedQty.decrement;
        }
        if (args.data.stockQty?.decrement !== undefined) {
          target.stockQty -= args.data.stockQty.decrement;
        }
        return Promise.resolve({ count: 1 });
      }),
    },
    order: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: jest.fn((args: any) => {
        let count = 0;
        for (const o of orders) {
          if (o.id !== args.where.id) continue;
          if (
            args.where.hasHouseStockItems !== undefined &&
            o.hasHouseStockItems !== args.where.hasHouseStockItems
          ) {
            continue;
          }
          Object.assign(o, args.data);
          count += 1;
        }
        return Promise.resolve({ count });
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: jest.fn((cb: any): any => cb(client)),
  };

  return client as unknown as PrismaService;
}

describe('HouseStockService.autoTransferStalePendingToSupplier', () => {
  it('bekleyen (paid + reservedQty>0 + dispatchedAt=null) siparişi tedarikçiye devreder', async () => {
    const orders: FakeOrder[] = [
      { id: 'o1', status: 'paid', hasHouseStockItems: true },
    ];
    const items: FakeItem[] = [
      {
        id: 'i1',
        orderId: 'o1',
        houseStockReservedQty: 3,
        houseStockDispatchedAt: null,
        houseStockReservedUntil: null,
        houseStockReservedOwnerId: 'owner-1',
        houseStockItemId: 'd1',
      },
    ];
    const depots: FakeDepot[] = [{ id: 'd1', reservedQty: 5, stockQty: 10 }];
    const prisma = buildPrismaMock({ orders, items, depots });
    const service = new HouseStockService(prisma);

    const res = await service.autoTransferStalePendingToSupplier();

    expect(res).toEqual({ orders: 1, releasedQty: 3 });
    // Depo rezervi düşer, RAFTAKİ stok DEĞİŞMEZ (ürün hâlâ rafta).
    expect(depots[0].reservedQty).toBe(2);
    expect(depots[0].stockQty).toBe(10);
    // OrderItem house-stock alanları temizlenir.
    expect(items[0].houseStockReservedQty).toBe(0);
    expect(items[0].houseStockItemId).toBeNull();
    expect(items[0].houseStockReservedOwnerId).toBeNull();
    // Bot bir sonraki tick'te temin etsin diye bayrak iner; status paid kalır.
    expect(orders[0].hasHouseStockItems).toBe(false);
    expect(orders[0].status).toBe('paid');
  });

  it('dispatch edilmiş (Kargoya Verilecek) siparişe ASLA dokunmaz', async () => {
    const orders: FakeOrder[] = [
      // dispatch sonrası status 'preparing' olur ve dispatchedAt set edilir.
      { id: 'o2', status: 'preparing', hasHouseStockItems: true },
    ];
    const items: FakeItem[] = [
      {
        id: 'i2',
        orderId: 'o2',
        houseStockReservedQty: 4, // dispatch reservedQty'yi sıfırlamaz
        houseStockDispatchedAt: new Date('2026-06-18T10:00:00Z'),
        houseStockReservedUntil: null,
        houseStockReservedOwnerId: 'owner-1',
        houseStockItemId: 'd2',
      },
    ];
    const depots: FakeDepot[] = [{ id: 'd2', reservedQty: 4, stockQty: 6 }];
    const prisma = buildPrismaMock({ orders, items, depots });
    const service = new HouseStockService(prisma);

    const res = await service.autoTransferStalePendingToSupplier();

    expect(res).toEqual({ orders: 0, releasedQty: 0 });
    expect(depots[0].reservedQty).toBe(4);
    expect(items[0].houseStockReservedQty).toBe(4);
    expect(orders[0].hasHouseStockItems).toBe(true);
  });

  it('paid olmayan siparişi kapsam dışı bırakır', async () => {
    const orders: FakeOrder[] = [
      { id: 'o3', status: 'shipped', hasHouseStockItems: true },
    ];
    const items: FakeItem[] = [
      {
        id: 'i3',
        orderId: 'o3',
        houseStockReservedQty: 2,
        houseStockDispatchedAt: null,
        houseStockReservedUntil: null,
        houseStockReservedOwnerId: 'owner-1',
        houseStockItemId: 'd3',
      },
    ];
    const depots: FakeDepot[] = [{ id: 'd3', reservedQty: 2, stockQty: 9 }];
    const prisma = buildPrismaMock({ orders, items, depots });
    const service = new HouseStockService(prisma);

    const res = await service.autoTransferStalePendingToSupplier();

    expect(res).toEqual({ orders: 0, releasedQty: 0 });
    expect(depots[0].reservedQty).toBe(2);
  });

  it('hiç bekleyen kalem yoksa erken döner', async () => {
    const prisma = buildPrismaMock({ orders: [], items: [], depots: [] });
    const service = new HouseStockService(prisma);

    const res = await service.autoTransferStalePendingToSupplier();

    expect(res).toEqual({ orders: 0, releasedQty: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
