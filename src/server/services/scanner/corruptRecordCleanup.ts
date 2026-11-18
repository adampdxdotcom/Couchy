import { db } from '../../db.ts';
import { logger } from '../../logger.ts';
import { notifyImageIndexed } from '../comfyuiLiveMonitor.ts';
import { invalidateStorageUsageStatsCache } from '../storageStatsService.ts';

/**
 * Deletes a single corrupt or 0x0 image record and any orphaned series rows from SQLite.
 */
export function deleteCorruptImageRecord(imageId: number): void {
  try {
    const row = db
      .prepare('SELECT id, content_hash FROM images WHERE id = ?')
      .get(imageId) as { id: number; content_hash: string } | undefined;
    if (!row) return;

    const tx = db.transaction(() => {
      db.prepare('UPDATE generation_items SET output_image_id = NULL WHERE output_image_id = ?').run(
        row.id
      );
      db.prepare('DELETE FROM image_series_items WHERE image_id = ?').run(row.id);
      db.prepare(
        'DELETE FROM image_series WHERE id NOT IN (SELECT DISTINCT series_id FROM image_series_items)'
      ).run();
      db.prepare('DELETE FROM images WHERE id = ?').run(row.id);

      const otherWithHash = db
        .prepare('SELECT 1 FROM images WHERE content_hash = ? LIMIT 1')
        .get(row.content_hash);
      if (!otherWithHash) {
        db.prepare('DELETE FROM ratings WHERE content_hash = ? AND rating = 0 AND is_favorite = 0').run(
          row.content_hash
        );
      }
    });
    tx();
    invalidateStorageUsageStatsCache();
  } catch (err) {
    console.warn(`Failed to clean up corrupt image record #${imageId}:`, err);
  }
}

/**
 * Self-healing cleanup that purges any 0-byte or 0x0 corrupt image rows (e.g. from disk-full writes).
 */
export function purgeCorruptZeroDimensionImages(): number {
  try {
    const corruptRows = db
      .prepare('SELECT id FROM images WHERE width <= 0 OR height <= 0 OR file_size <= 0')
      .all() as { id: number }[];
    if (corruptRows.length === 0) return 0;

    for (const row of corruptRows) {
      deleteCorruptImageRecord(row.id);
    }
    logger.warn('Scanner', `Purged ${corruptRows.length} corrupt 0x0/0-byte image record(s) from SQLite`);
    notifyImageIndexed();
    return corruptRows.length;
  } catch (err) {
    logger.warn('Scanner', 'Failed to purge corrupt 0x0 image records', err);
    return 0;
  }
}
