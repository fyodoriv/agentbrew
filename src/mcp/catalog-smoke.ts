import { type Catalog, type CatalogMcpProbeSuppression, loadCatalog } from "../catalog/types.js";
import { BUILTIN_DEEP_SMOKE, type DeepSmokeSpec } from "./probe.js";

function buildSmokeMap(
  catalog: Catalog,
  includeServer: (server: Catalog["mcp_servers"][number]) => boolean,
): Map<string, DeepSmokeSpec> {
  const deepMap = new Map<string, DeepSmokeSpec>(Object.entries(BUILTIN_DEEP_SMOKE));
  for (const server of catalog.mcp_servers) {
    if (server.smokeCall && includeServer(server)) {
      deepMap.set(server.name, server.smokeCall);
    }
  }
  return deepMap;
}

export function buildDeepSmokeMap(catalog: Catalog = loadCatalog()): Map<string, DeepSmokeSpec> {
  return buildSmokeMap(catalog, () => true);
}

// Browser-category servers open a visible window on a tool call, so the
// scheduler never deep-probes them even without an explicit `probe: fast`.
export function buildSchedulerDeepSmokeMap(catalog: Catalog = loadCatalog()): Map<string, DeepSmokeSpec> {
  return buildSmokeMap(catalog, (server) => server.probe !== "fast" && server.category !== "browser");
}

export function buildSchedulerProbeSuppressionMap(
  catalog: Catalog = loadCatalog(),
): Map<string, CatalogMcpProbeSuppression> {
  const suppressions = new Map<string, CatalogMcpProbeSuppression>();
  for (const server of catalog.mcp_servers) {
    if (server.probeSuppression) {
      suppressions.set(server.name, server.probeSuppression);
    }
  }
  return suppressions;
}
