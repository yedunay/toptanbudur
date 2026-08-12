import { IsBoolean } from 'class-validator';

export class CategoryActiveDto {
  // Kategori aktif mi? false → bu kategoriye düşen feed satırları ingest
  // tarafından atlanır; mevcut aktif ürünler bir sonraki sync'te deactive edilir.
  @IsBoolean()
  isActive!: boolean;
}
