# stage-ui-live2d

This package provides Live2D scene components, model parameters, expression state, and expression tools for AIRI clients.

## Use

Import scene components from `@proj-airi/stage-ui-live2d/components/scenes`.
Import the expression store from `@proj-airi/stage-ui-live2d/stores/expression-store`.
Use this package when a client renders a Cubism model or controls its expressions.
Use `stage-ui-three` for VRM scenes.

## Expression groups

A group is active when every parameter matches its expression target, including targets of zero.
Shared values do not identify a complete expression.

`set(groupName, true)` applies the group's individual targets.
`set(groupName, false)` restores model defaults.
A numeric intensity interpolates each parameter from its model default to its group target.
Direct parameter commands keep their existing value semantics.

## LLM exposure

The store saves `all`, `none`, or `custom` access and custom expression selections in localStorage for each model ID.
Loading the same model restores its selection. Unloading the model clears runtime state and keeps the saved selection.
New models and invalid saved policies start with no access. Custom policies include only expression names found in the loaded model.
Selections made before this persistence change need to be selected once more.

## Cursor focus

When eye tracking is enabled, cursor input owns idle gaze.
After the cursor stops for one second, the model eases back to neutral focus.
Missing input has no canvas coordinate. It releases the SDK focus target to normalized `(0, 0)`.
Idle eye offsets are cleared before SDK focus, expressions, and manual controls.
When tracking is disabled, the idle eye animation setting controls automatic gaze.

## Checks

```sh
pnpm -F @proj-airi/stage-ui-live2d typecheck
pnpm exec vitest run --project stage-ui-live2d:node packages/stage-ui-live2d/src/stores/expression-store.test.ts packages/stage-ui-live2d/src/composables/live2d/expression-controller.test.ts
pnpm exec vitest run --config packages/stage-ui-live2d/vitest.config.ts src/composables/live2d/eye-tracking.browser.test.ts src/composables/live2d/motion-manager.test.ts
```
