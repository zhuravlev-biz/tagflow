/**
 * Programmatic access to the CLI's building blocks (the `tagflow` binary is
 * the primary interface).
 */
export { loadConfigFile, writeConfigFile, ConfigError, DEFAULT_CONFIG_PATH } from './config-io.js'
export {
  createProbeEngine,
  createPaapiEngine,
  PAAPI_ENDPOINTS,
  type CheckEngine,
  type ListingStatus,
  type PaapiCredentials,
} from './check/engines.js'
export { checkTargets, evaluate, runCheck, type CheckAction, type CheckTarget } from './commands/check.js'
export { runValidate } from './commands/validate.js'
export { runInit } from './commands/init.js'
export { runStats } from './commands/stats.js'
export { runImportEarnings } from './commands/import-earnings.js'
export {
  aggregateByTag,
  marketplacesForTag,
  parseAmount,
  parseEarningsReport,
  type EarningsRow,
  type TagTotals,
} from './earnings/report.js'
export {
  aeQuery,
  AeError,
  credentialsFromEnv,
  isSafeDatasetName,
  type AeCredentials,
  type AeQueryResult,
  type AeRow,
  type FetchLike,
} from './stats/ae.js'
