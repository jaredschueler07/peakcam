# Poster module warmup

Branch `feat/drop-in-v3-module-warmup`, based on integration6ac431c. No GPU/browser launched.

Justification from cold-4g.json: runtime dependency chunks began1497ms and ended2133ms; GPU chunks962d955b394d50f9/d0c46044b12f9be5 began2161–2162ms, with181,729byte renderer ending2746ms; five material modules began2792ms; post chunks09cbb5370b6ee2cb/351a3fa565edf068 began3036ms and ended3224ms. Installed compiled modules/source confirm separate runtime, GPU backend and NodePostProcessing dynamic boundaries. The prior optimization measured3830ms navigation-to-ready; this change claims no new timing result until root remeasures.

Dedicated DropInGame poster mount now warms the createGame module and, only when backend selection resolves WebGPU, the WebGPU module in parallel. Forced `gfx=webgl` and browsers without navigator.gpu warm only the normal runtime bundle. Backend code loading is separated from `createRendererBackend`: the same imported module is reused at Start, when the constructor/device initialization finally runs. No runtime, canvas, adapter/device, animation loop, textures or scene is instantiated by poster warmup. No other site route invokes the warmup.

NodePostProcessing module loading starts alongside the five material factory imports. Its optional failure is observed without rejecting factories; Renderer retains normal post-loading/fallback handling. Shader prewarm and startWhenWarm remain unchanged and awaited, including current cold-ready criteria.

Cancellation: imports are not cancellable once started, but own only module-cache code. Pre-abort/unmount before queued starts prevents imports; late import failure is observed after unmount. No late callback creates a renderer or starts a run, so no graphics ownership transfers occur during poster warmup. Existing startup helper's abort/backend ownership tests continue passing.

Validation:32 focused poster/startup/backend/node-boundary tests pass, TypeScript no-emit passes, diff check clean. ESLint reports no errors; the existing DropInGame loading-effect missing-physicsModel dependency warning remains unchanged. Tests explicitly prove module exports are not invoked during preload, forced/unsupported WebGL never calls the GPU importer, and cancelled/failed preload paths do not leak unhandled rejections. Network contention with terrain preloads is an explicit measurement tradeoff: root must compare final cold waterfall and actual ready time, not infer a budget pass from source ordering.
