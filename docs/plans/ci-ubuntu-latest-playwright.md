# Restore the hosted Linux runner label

- Hypothesis: Playwright 1.61.0, the first release with Ubuntu 26.04 support, installs Chromium on the new hosted image. Install failures fall from one in one recorded run to zero.
- Measurement: run the normal hosted CI workflow with `ubuntu-latest`. Read the runner image and the Chromium install step in the log.
- Success: the Linux job runs on Ubuntu 26.04 and both hosted verification jobs pass.
- Pivot: keep the Ubuntu 24.04 pin if the Ubuntu 26.04 job fails on the supported Playwright version or changes to unrelated dependency paths are needed.
- Anchor: [Playwright 1.61.0 release](https://github.com/microsoft/playwright/releases/tag/v1.61.0) and the existing `ci-ubuntu-latest-playwright` task.
