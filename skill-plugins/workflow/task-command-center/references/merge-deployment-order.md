# Merge / deployment order (cross-repo chains)

Every chain PR includes **## Merge / deployment order** with the **complete** chain — all repos, all PR numbers. One section only (no separate "Cross-repo wiring").

| Column | Content |
|--------|---------|
| Order | Merge/deploy sequence |
| Repo | `org/repo` slug |
| PR | `#number` + link |
| Description | One-line role |
| Deploy alone safe? | ✅ / ⚠️ + hard error vs soft miss |

**Same section must note:** hard errors, soft misses, feature-flag gating, cross-links to other chain PRs.

**Example chain (checkout feature):**

| Order | Repo | PR | Description | Deploy alone safe? |
|-------|------|----|-------------|-------------------|
| 1 | shop-core | #101 | Shared action handler + runtime props | ✅ Yes — no dependencies |
| 2 | shop-widgets | #12 | Checkout widget | ⚠️ **Draft until #101 merges** — needs the shared handler |
| 3 | shop-config | #340 | Checkout config (keep flag OFF until #12 is released) | ⚠️ Hard error if flag ON before #12 |
| 4 | shop-experiences | #7 | "Start checkout" call to action | ⚠️ **Draft until #101 merges** — CTA does nothing without the handler |

**Why #101 first:** the shared action handler is registered at app start. The widget and the CTA both depend on it.

**Why #340 cannot precede #12 (flag ON):** the config references the widget, but the loader cannot resolve an unreleased widget, so the panel shows a hard error.

**Flag gating (#340):** keep `checkout-widget-enabled` OFF until #12 is released.
