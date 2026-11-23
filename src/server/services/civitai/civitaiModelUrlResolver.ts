import { resolveCivitaiDomain, type CivitaiDomain } from './civitaiUrlAndDomain.ts';
import {
  fetchCivitaiJsonWithFallback,
  fetchCivitaiParentModelWithDomain,
  getCivitaiHeaders,
  probeCivitaiWebDomain,
} from './civitaiHttpClient.ts';
import { buildCivitaiSearchResultCard, extractCivitaiVersions } from './civitaiVersionBuilders.ts';
import type { ExternalModelSearchResult } from '../../../shared/types.ts';

/**
 * Resolves a pasted Civitai model page or API download URL (.com or .red) into an ExternalModelSearchResult card.
 */
export async function resolveCivitaiModelUrl(input: string): Promise<ExternalModelSearchResult> {
  const url = new URL(input);
  const initialDomain: CivitaiDomain = url.hostname.toLowerCase().endsWith('civitai.red')
    ? 'civitai.red'
    : 'civitai.com';
  let detectedDomain: CivitaiDomain = initialDomain;
  const headers = getCivitaiHeaders();

  const verParam = url.searchParams.get('modelVersionId');
  const apiDownloadMatch = url.pathname.match(/\/api\/download\/models\/(\d+)/i);
  const modelPageMatch = url.pathname.match(/\/models\/(\d+)/i);

  let parentModel: any = null;
  let targetVer: any = null;

  if (apiDownloadMatch || (verParam && !modelPageMatch)) {
    const verId = apiDownloadMatch ? apiDownloadMatch[1] : verParam!;
    const verRes = await fetchCivitaiJsonWithFallback(
      `/api/v1/model-versions/${verId}`,
      headers,
      initialDomain
    );
    if (!verRes?.data) {
      throw new Error(`Civitai version ${verId} lookup failed on both civitai.com and civitai.red`);
    }
    targetVer = verRes.data;
    if (verRes.domain === 'civitai.red') detectedDomain = 'civitai.red';
    if (targetVer?.modelId) {
      const parentRes = await fetchCivitaiParentModelWithDomain(
        targetVer.modelId,
        headers,
        detectedDomain
      );
      parentModel = parentRes.model;
      if (parentRes.domain === 'civitai.red') detectedDomain = 'civitai.red';
    }
  } else if (modelPageMatch) {
    const modelId = modelPageMatch[1];
    const parentRes = await fetchCivitaiParentModelWithDomain(modelId, headers, initialDomain);
    parentModel = parentRes.model;
    if (parentRes.domain === 'civitai.red') detectedDomain = 'civitai.red';
    if (!parentModel) {
      throw new Error(`Civitai model ${modelId} not found.`);
    }
    const versions: any[] = Array.isArray(parentModel.modelVersions)
      ? parentModel.modelVersions
      : [];
    targetVer =
      (verParam ? versions.find((v) => String(v.id) === String(verParam)) : null) || versions[0];
  }

  if (!targetVer) {
    throw new Error('Could not resolve a downloadable model version from that Civitai URL.');
  }

  const resolvedModelId = parentModel?.id || targetVer.modelId;
  let finalDomain = resolveCivitaiDomain(parentModel, targetVer, detectedDomain);
  if (finalDomain === 'civitai.com' && resolvedModelId) {
    finalDomain = await probeCivitaiWebDomain(resolvedModelId, finalDomain);
  }

  const rawType = String(parentModel?.type || targetVer?.model?.type || 'Checkpoint');
  const availableVersions = extractCivitaiVersions(
    parentModel,
    targetVer,
    rawType,
    finalDomain
  );
  const activeVersion =
    availableVersions.find((v) => v.versionId === String(targetVer.id)) ||
    availableVersions[0];

  if (!activeVersion) {
    throw new Error('No downloadable weight files found on that Civitai model version.');
  }

  return buildCivitaiSearchResultCard({
    parentModel,
    targetVer,
    availableVersions,
    activeVersion,
    fallbackDescription: 'Resolved from Civitai URL',
  });
}
