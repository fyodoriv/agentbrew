# Synthetic demo recording control (#828)

## Prediction before implementation

Goal: record a useful demo when only Playwright's bundled encoder is available.
Question: can a Chromium screencast be encoded and decoded with that binary?
Compare one old concat/H.264 attempt with one JPEG-pipe/VP9 attempt on the
same synthetic page. Expect zero playable clips from the old attempt and one
from the new attempt. Success is 1/1 candidate clips with two distinct decoded
visual states and a fixed 5 fps timeline; any capture, encode, decode, timing,
or cleanup failure is 0/1 and abandons this route. Do not retry a failed run
to select a favorable result.

Measurement, to be added after this prediction is committed:

```sh
PLAYWRIGHT_FFMPEG="$HOME/Library/Caches/ms-playwright/ffmpeg-1013/ffmpeg-mac" node skill-plugins/workflow/run-goal/evals/demo-video-probe.mjs
```

The probe must pin the encoder SHA-256 to
`e71dd6610cbc984022ff51b07a95f8d2526aba120406d8cdd0686f6421c464ac`
and Playwright version to `1.58.2`. It starts a fresh headless browser on a
synthetic page, records CDP JPEG frames, acknowledges every frame, and changes
the page between two known colors. No signed-in page or user data is used.
It must retain the frames and both encoder outcomes locally, reconstruct a
5 fps timeline with each idle gap capped at one second, and decode frames from
the resulting WebM to verify both visual states. The old attempt must fail
without a playable clip; the new attempt must exit zero and pass the decode
and timeline assertions. The probe closes the browser and bounds its wait.

This measures a synthetic local workflow, not recording a user's existing tab,
all Playwright encoder versions, or the behavior of an agent reading the skill.
The latter needs its own evaluation before claiming that agents improved.

Anchors: [Chrome DevTools Page protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/)
and [Goal Question Metric](https://doi.org/10.1002/9780470172669.ch12).
