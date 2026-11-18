# Qualify Claude command hooks on OpenCode 2

The installed bridge exports a V1 hook map. OpenCode 2.3.0 rejected that
export before a provider request. Hosted loopback checks admitted a native
V2 bridge, ran the existing commands, and loaded the combined source from
the exact managed plugin path. The earlier provider timeout has a separate
cause to establish.

- **Hypothesis**: Versioned deployment admits both pinned runtimes and
  retains all four registered V2 safety effects. GQM asks whether a V2
  action reaches its Claude command and obeys the result before execution.
- **Measurement**: In temporary homes, run the ownership and sync tests
  with pinned version responses, then use the artifacts rendered by that
  code in OpenCode 1.19.5 and 2.3.0. Count the exact approve, amend, deny and
  lifecycle markers. Check the prompt and tool feedback in the local model
  fixture. Run the hosted gate.
- **Success**: Two of two loaders accept. Each of the four V2 effects is
  exact, zero denied tool effects run, zero owner files change, and both
  read-only previews leave helper bytes and manifest unchanged.
- **Pivot**: A missing guard, duplicate hook, incompatible runtime,
  owner-file change, or unknown version replacement blocks that route.
  Leave any unrelated provider timeout open. Keep unsupported events
  separate from the capability that the live tests cover.
- **Anchor**: The existing task, [V2 admission at the managed
  destination](https://github.com/fyodoriv/agentbrew/actions/runs/44300093697),
  and the [V2 guard matrix](https://github.com/fyodoriv/agentbrew/actions/runs/44298180750).

Treat the V1 source as the common implementation. Select the V2 adapter
only after the CLI reports a supported major. Reuse the existing single
target, atomic write and manifest ownership check. A missing or unsupported
version leaves the installed helper in place. Write no OpenCode config.

## Results

- The owned deployment unit test failed on the old V2 output. It saw
  unchanged V1 bytes. The corrected path installs V2, restores the exact
  V1 bytes after a downgrade, retains the file for unknown versions,
  and keeps both the user-edited target and the separate user plugin.
  The preview test also caught an unconditional standalone manifest
  write. Preview now leaves the manifest and the bridge alone.
- The real `agentbrew sync --only instructions` installed the tested
  artifacts in private scratch homes. OpenCode 1.19.5 loaded the exact
  V1 source and produced one start and one end. The three OpenCode 2.3.0
  tool cases each sent one prompt note. Approval wrote one original
  marker, amendment wrote one changed marker, and denial wrote neither.
  The two successful tool actions returned one feedback note each.
  [Both built paths and the guard matrix](https://github.com/fyodoriv/agentbrew/actions/runs/44302297823).
- An early V2 lifecycle test read the plugin inventory as soon as server
  health responded. A bounded inventory wait later found the native
  plugin once. A lifecycle with an explicit workspace produced one start
  and one end for the same session with zero model requests and no extra
  records. The named tool cases did not observe a start callback. The
  lifecycle claim is limited to the verified workspace route.
  [Deployed V2 lifecycle](https://github.com/fyodoriv/agentbrew/actions/runs/44302539949).
- Stop, session ownership across restarts, and the separately observed
  provider timeout remain outside these controls.

The [registered cold and warm comparison](https://github.com/fyodoriv/agentbrew/actions/runs/44303400336)
held the runtime, artifact and fixture tool constant. Both cases approved
once. The case that waited for plugin inventory ran one start callback.
The case that waited only for authenticated health ran none.
