# Official Babylon.js Resources & Troubleshooting Approach

## Troubleshooting Approach

**CRITICAL: Always check official resources before improvising solutions.**

Order when debugging Babylon.js issues:

1. **Official Babylon.js documentation first**
   - [Babylon.js Documentation](https://doc.babylonjs.com/)
   - [Babylon.js API Reference](https://doc.babylonjs.com/typedoc/index)
   - [Babylon.js Playground](https://playground.babylonjs.com/) — working examples for every feature

2. **Search Babylon.js forum for similar issues**
   - [Babylon.js Forum](https://forum.babylonjs.com/)
   - Most common issues have already been solved and documented

3. **Check git history for recent changes**
   - If something "was working till refactor", check what changed in that refactor
   - Often the fix is restoring removed functionality, not adding new code

4. **Only then implement custom solutions**
   - If the issue isn't documented and git history doesn't reveal a simple fix, then implement a solution

**What NOT to do:**
- ❌ Improvise solutions without checking official docs
- ❌ Add complex workarounds when simple fixes exist
- ❌ Skip checking git history when something recently broke

## Primary Resources

- [Babylon.js Documentation](https://doc.babylonjs.com/) — official docs and tutorials
- [Babylon.js API Reference](https://doc.babylonjs.com/typedoc/index) — complete API documentation
- [Babylon.js Playground](https://playground.babylonjs.com/) — live examples for every feature
- [Babylon.js Forum](https://forum.babylonjs.com/) — community support and solutions

## Key Documentation Areas

- [How to Create a Basic Scene](https://doc.babylonjs.com/features/featuresDeepDive/scene) — scene setup and lifecycle
- [Cameras](https://doc.babylonjs.com/features/featuresDeepDive/cameras) — camera types and configuration
- [Engine](https://doc.babylonjs.com/features/featuresDeepDive/gameEngine) — engine options and resize handling
- [Materials](https://doc.babylonjs.com/features/featuresDeepDive/materials) — material creation and management
- [Meshes](https://doc.babylonjs.com/features/featuresDeepDive/mesh) — mesh creation and manipulation

## Common Forum Solutions

- [Canvas resize patterns](https://forum.babylonjs.com/t/make-canvas-responsive-and-fill-remaining-space/27488)
- [Engine resize issues](https://forum.babylonjs.com/t/engine-resize-on-html-element-size-change/31005)
- [Memory management](https://forum.babylonjs.com/search?q=memory%20leak)
