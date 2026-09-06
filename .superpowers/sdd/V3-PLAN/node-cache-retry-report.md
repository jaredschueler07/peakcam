# Poster node-module retry

Confirmed that `loadNodeFactories` retained a rejected Promise indefinitely. A transient speculative poster download failure could therefore prevent later Start attempts from loading the node pipeline.

The loader now uses a small injected loader factory to share in-flight and successful requests while clearing rejected requests. Optional post-processing module failures remain observed separately. The focused test verifies shared failure, a new successful Start request, and stable success caching; existing tests still verify the dynamic module boundary and poster initialization behavior.

Reviewed `db0aa3a`: node factory module downloads are confined to the WebGPU-supported poster path. Importing the modules does not call their exported constructors/factories or create a renderer/context. The ordinary Start lifecycle retains resource ownership. This fix removes our rejected-Promise cache; it cannot make a browser retry a permanently failed module evaluation retained by its own module system.

Validation: 7 focused tests pass, TypeScript and focused ESLint pass, and diff whitespace checks pass. No browser/GPU launch or cold-start performance claim.
