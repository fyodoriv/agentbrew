/** Pinned upstream memory service spec — matches dotfiles mcp-memory-launchagent. */
export const MEMORY_PINNED_SPEC = "mcp-memory-service[sqlite]==11.7.0" as const;

export const MEMORY_MCP_HOST = "127.0.0.1";
export const MEMORY_MCP_PORT = 18765;

export const MEMORY_MCP_URL = `http://${MEMORY_MCP_HOST}:${MEMORY_MCP_PORT}/mcp`;

/**
 * Canonical runtime configuration for the shared memory daemon.
 * Keep this here so every install/reconcile path produces the same LaunchAgent.
 */
export const MEMORY_DAEMON_ENVIRONMENT = {
  MCP_MEMORY_STORAGE_BACKEND: "sqlite_vec",
  MCP_HYBRID_FUSION_METHOD: "rrf",
  MCP_EMBEDDING_MODEL: "all-MiniLM-L6-v2",
  MCP_BOOTSTRAP_ENABLED: "true",
  MCP_BOOTSTRAP_MAX_TOKENS: "1536",
  MCP_CONSOLIDATION_ENABLED: "true",
  MCP_SCHEDULE_DAILY: "02:00",
  MCP_SCHEDULE_WEEKLY: "SUN 03:00",
  MCP_SCHEDULE_MONTHLY: "01 04:00",
  MCP_BACKUP_ENABLED: "true",
  MCP_BACKUP_INTERVAL: "daily",
  MCP_BACKUP_RETENTION: "14",
  MCP_QUALITY_BOOST_ENABLED: "false",
  MCP_FORGETTING_ENABLED: "false",
} as const;

/** Default max backup age before doctor reports stale (26 hours). */
export const MEMORY_BACKUP_MAX_AGE_SEC = 93_600;
/** Daily backups kept by `agentbrew memory maintain` (two weeks). */
export const MEMORY_BACKUP_KEEP = 14;

/** Managed MCP server name wired by `agentbrew memory enable`. */
export const MEMORY_MANAGED_SERVER_NAME = "memory";

export const MEMORY_MANAGED_SOURCE = "agentbrew-memory";

/** Reserved tag prefixes — pack reconciliation must not collide with user tags. */
export const PACK_TAG_PREFIX = "pack:";
export const AGENTBREW_TAG_PREFIX = "agentbrew:";
export const SUPERSEDED_TAG_PREFIX = "superseded:";

export const PACK_SCHEMA_VERSION = 1;
