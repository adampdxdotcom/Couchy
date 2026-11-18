/**
 * Public facade for Couchy's image scanner, metadata indexer, thumbnail cache,
 * and filesystem watcher modules under `./scanner/`.
 */

export type { IndexSingleResult } from './scanner/imageIndexer.ts';
export { indexSingleImageFile } from './scanner/imageIndexer.ts';

export { purgeCorruptZeroDimensionImages } from './scanner/corruptRecordCleanup.ts';

export {
  computeFileSha256,
  ensureWebpThumbnail,
  indexUploadedInspirationImage,
  resolveImageDiskPath,
  runBackgroundThumbnailMigration,
} from './scanner/scannerMediaUtils.ts';

export {
  recomputeImageDependencyStatus,
  resolveAppearanceForCharacter,
} from './scanner/scannerPersistenceHelpers.ts';

export {
  backfillMissingImagePrompts,
  copyImageMetadataToDerivedImage,
} from './scanner/derivedMetadataService.ts';

export {
  getActiveScanStatus,
  runDirectoryScan,
  startFilesystemWatcher,
} from './scanner/directoryScanService.ts';
