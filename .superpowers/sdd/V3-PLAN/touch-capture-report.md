# Mobile multitouch capture fix

At a 390px viewport the Tuck button center is x=199, inside the steering adapter's left-55% hit region. Its bubbled pointerdown could replace the active steering pointer and steal the button capture. That is a UI input bug, independent of simulation or finish geometry.

The adapter now excludes interactive targets and their descendants, and ignores additional pointers while steering is active. Tuck-first and steer-first both retain independent button and steering ownership. Clearing, releasing, cancelling, losing capture and disposing release the steering capture and zero its analog input. Button capture remains owned by the button.

Seven focused input tests pass, including both multi-touch orders with a delegated nested button target, analog remapping, second-pointer rejection, and lifecycle cleanup. TypeScript, ESLint and whitespace checks pass. No browser/GPU run; root owns the actual touch calibration and matrix. No physics, quality or finish changes.
