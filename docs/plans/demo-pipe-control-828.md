# Saved-frame video control (#828)

## Prediction before implementation

The previous browser control stopped before candidate encoding. This is a
different, narrower measurement: encode its two saved synthetic frames, with
no browser capture or baseline retry. Goal: verify that the bundled encoder
can make a playable two-state VP9 clip. Question: do ten supplied frames at
5 fps produce the expected decoded colors, frame count and duration?

Measurement, to be added after this prediction is committed:

```sh
node skill-plugins/workflow/run-goal/evals/demo-pipe-control.mjs
```

The input frames are the saved red and blue JPEGs from the prior control.
Their respective SHA-256 hashes must be
`dab5da1533ff7b250141c739abba66a10f12b23c4d961a3ae33928c7d39f4f1d` and
`c7c342de72976b1f74232e145f21e2cdf9e325c362adf833111399565c77e9e2`.
Pin Playwright's bundled encoder to SHA-256
`e71dd6610cbc984022ff51b07a95f8d2526aba120406d8cdd0686f6421c464ac`;
pin the independent local FFmpeg and FFprobe binaries to
`7f6028378534aa10a2dfa07d807ddcc0d18c869bf5c2f64c89efcc18ee88c4ee` and
`bfe676bfc3a889bebe63af07c71a926a6167f568c7a932a79c2f1fe51ae6d5a1`.
Use five copies of each input frame, in red-then-blue order, as an image2pipe
input. The candidate must encode once to VP9 WebM. Independently inspect the
output with FFprobe and decode the first and last frames with the system
FFmpeg. FFprobe uses `-count_frames` and reports the video stream's
`nb_read_frames` and `avg_frame_rate`. The decoder processes the full clip
in order, scales each frame to one RGB pixel and writes raw RGB bytes. Sample
the first three bytes and the last three bytes of the ten-frame stream. Save
the command outcomes, stream metadata and sampled RGB values.

Success is 1/1 clips with codec VP9, exactly ten frames at 5 fps, a duration
within 0.05 seconds of two seconds, and the first and last decoded pixels
respectively red and blue by at least 100 channel levels. Any mismatch,
timeout or failed command is 0/1 and abandons this path. Do not retry the
control to select a favorable result.

This is a codec and decode control using already saved frames. It does not
test screencast timing reconstruction, idle-gap capping, live-tab attachment,
browser cleanup, or agents' use of the skill. It cannot by itself close #828.
Anchor: [Goal Question Metric](https://doi.org/10.1002/9780470172669.ch12).

## Result

On 2026-11-06, the one saved-frame control passed. The bundled encoder made
one VP9 WebM clip. The independent inspector reported ten frames, 5/1 fps
and 2.000000 seconds. The independent decoder produced ten RGB samples; the
first was `[241, 20, 22]` and the last was `[20, 20, 241]`. All three
recorded commands exited zero. The output SHA-256 was
`34c59c4eb6dc190812911e603d692b5ab82558ff8b2f24f2c83900a2a43eb052`.

Private local evidence retains the control script, output, command outcomes,
metadata and decoded samples. The script and its input frames are not in this
tree, so the registered command cannot be run from the branch alone. This
result establishes only the saved-frame codec path described above; it does
not resolve the untested recording and agent-behavior questions.
