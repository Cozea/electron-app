export {
  createSubstrateNdjsonWriter,
  getSharedSubstrateNdjsonWriter,
  resetSharedSubstrateNdjsonWriterForTests,
  type CreateSubstrateNdjsonWriterOptions,
  type SubstrateNdjsonSpan,
  type SubstrateNdjsonWriter,
} from "./ndjsonSpanWriter";

export {
  exportSubstrateSpanToOtlp,
  isOtlpEnabled,
  resolveOtlpEndpoint,
  type OtlpExportResult,
} from "./otlpExporter";
