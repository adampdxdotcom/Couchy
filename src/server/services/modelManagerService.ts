/**
 * Backward-compatible facade re-exporting external model search,
 * download confirmation/scheduling, and download execution controls.
 */
export {
  searchCivitaiModels,
  searchHuggingFaceModels,
  resolveDirectModelUrl,
  smartSearchModels,
  smartSearchModelsWithNotice,
  type ExternalModelSearchResult,
} from './modelSearchService.ts';

export {
  markDownloadJobPending,
  clearDownloadJobPending,
  isDownloadJobActive,
  abortActiveDownloadStream,
  abortAllActiveDownloadStreams,
  executeDownloadJob,
  type ScheduledDownloadPayload,
  type ExecuteDownloadJobParams,
} from './modelDownloadExecutor.ts';

export { startConfirmedModelDownload } from './modelDownloadConfirmationService.ts';
