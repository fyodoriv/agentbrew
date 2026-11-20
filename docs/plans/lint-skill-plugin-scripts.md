# Include shipped skill scripts in Biome lint

- **Hypothesis**: A planted style error in a skill plugin script is missed by the two existing lint commands and detected by both after the change. The covered scripts pass on a clean tree.
- **Measurement**: Run `node_modules/.bin/biome check skill-plugins --error-on-warnings` and capture its diagnostics. Plant one regular script under a disposable skill directory and run `npm run lint` and `npm run lint:changed` on the same input. Verify the full gate points at the same script scope.
- **Success**: Both commands name the planted error. The clean skill scripts have zero Biome findings. Skill documents and eval data stay untouched.
- **Pivot**: A missed script, unexpected non-script file change, or an unrelated lint inclusion rejects the candidate. Keep the scope at the existing skill script paths.
- **Anchor**: The `lint-skill-plugin-scripts` task and the measured Biome exclusions in `package.json` and `scripts/lint-changed.sh`.

The original lint commands both exited zero with the planted script.
The repaired commands each reported it and exited one. Scoped Biome
found five script errors before the repair and zero after it. The
separate dashboard diagnostic stayed outside the script scope.

After the prediction check merged, the new lint scope found two extra
complexity errors in its argument and task parsers. The fixed checkout
passed Biome. Fourteen before/after invocations returned the same statuses
and output, and all 70 affected tests passed.
