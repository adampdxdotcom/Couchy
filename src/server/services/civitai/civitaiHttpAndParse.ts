/**
 * Backward-compatible facade re-exporting Civitai URL/domain helpers,
 * cached HTTP transport, metadata extractors, version builders, and URL resolver.
 */
export {
  buildCivitaiUrl,
  isBaseModelResourceType,
  isKrea2BaseModel,
  isLoraResourceType,
  parseCivitaiShareUrl,
  parseIdsFromCivitaiUrl,
  parsePreviewImagesJson,
  resolveCivitaiDomain,
  rewriteCivitaiDownloadUrl,
  type CivitaiDomain,
  type ParsedCivitaiShareUrl,
} from './civitaiUrlAndDomain.ts';

export {
  clearCivitaiHttpCache,
  fetchCivitaiJsonWithFallback,
  fetchCivitaiParentModel,
  fetchCivitaiParentModelWithDomain,
  getCivitaiHeaders,
  probeCivitaiWebDomain,
  type CivitaiFetchOptions,
} from './civitaiHttpClient.ts';

export {
  computeScheduledUnlockIso,
  extractCivitaiEarlyAccessInfo,
  extractRecommendedWeight,
  extractStaticPreviewImages,
  formatCivitaiHtmlDescription,
  type CivitaiEarlyAccessInfo,
} from './civitaiMetadataExtractors.ts';

export {
  buildCivitaiSearchResultCard,
  buildCivitaiVersionOption,
  extractCivitaiVersionFiles,
  extractCivitaiVersions,
  normalizeCivitaiData,
  type CivitaiNormalizedMeta,
} from './civitaiVersionBuilders.ts';

export { resolveCivitaiModelUrl } from './civitaiModelUrlResolver.ts';
