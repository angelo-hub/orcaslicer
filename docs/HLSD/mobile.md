# Mobile build of the slicing core

OrcaSlicer's slicing engine, `libslic3r`, has no dependency on wxWidgets or OpenGL. The mobile build packages that engine, plus a thin C++ façade, as a static library that a React Native app links through Nitro Modules. The desktop GUI is not part of it.

## What the build produces

`ORCA_MOBILE=ON` on the root CMake project builds:

- `libslic3r` and the in-tree libraries it links (`deps_src/`), unchanged.
- `libslic3r_mobile` (`src/mobile/core/`), the façade. It is the only public surface of the mobile library: plain C++17, no platform or toolkit includes, so the same code serves iOS and Android. `Session` is one project: the preset bundle, the model and the print, with synchronous slicing that the bridge runs on its own worker thread and a `cancel()` that is safe from any thread. Loading presets installs every vendor present in the resources directory's `profiles` into the data directory's `system` folder, where the preset bundle reads them, as the desktop's updater does for the vendors the user enabled; the app fetches only the vendors the user chose. Option metadata comes out as JSON so the app can generate its parameter editor from `PrintConfigDef` instead of hand-writing forms.

It does not build the GUI library, the CLI executable, the embedded Python runtime, the developer tools or sandboxes. The in-tree libraries that only the GUI uses (`hidapi`, `imguizmo`, the `hints` tool) are skipped as well. Everything else in the root project is left as it is; when the option is off the desktop builds are unaffected. `BUILD_TESTS` still works on a desktop host and adds the `tests/mobile` suite, which slices a real model through the façade against the shipped vendor profiles.

`scripts/build_ios_core.sh` drives the two-stage build for iOS and merges the static archives of one or more slices (device, simulator) into `OrcaCore.xcframework`, whose headers are the façade's headers only.

## Dependencies

The dependency superbuild in `deps/` gains a platform file, `deps-ios.cmake`, selected when `CMAKE_SYSTEM_NAME` is `iOS`. It forwards the iOS description (system name, sysroot, architecture, deployment target) to every CMake-based dependency, since ExternalProject does not forward it, and sets the flags the autotools and OpenSSL recipes need. `DEPS_MOBILE`, forced on for iOS and available on any host, selects a dependency list that leaves out what the core does not link: wxWidgets, GLEW, GLFW, OpenCSG, libcurl, FFmpeg, Python and wxInspector. A desktop host builds that list to compile the core and run the façade tests natively.

Two constraints shape the recipes:

- CMake's built-in iOS support restricts `find_package` to the SDK. The deps prefix is added as a find root with mode `BOTH` so dependencies and the core still find each other, while `CMAKE_IGNORE_PREFIX_PATH` keeps host package managers out.
- Nothing built for iOS can execute on the build host, so no recipe may run a program it just compiled. The autotools recipes are configured with an explicit `--host` for the same reason.

## Layering above the core

`mobile/packages/orca-core` is the Nitro Module. Its TypeScript spec (`src/specs/OrcaCore.nitro.ts`) mirrors `Session.hpp` one to one, and nitrogen generates the C++ spec classes that `cpp/HybridOrcaSession.cpp` implements over the façade. The façade is not thread-safe, so the bridge serializes every call with one mutex per session: promise-returning methods (load presets, import, arrange, slice, export) run on Nitro's thread pool holding it, synchronous methods take it with `try_lock` and throw while a long operation holds it, and `cancel()` never takes it. Progress callbacks are void-returning JS functions, which Nitro dispatches to the JS thread, so the slice thread may call them directly.

The Expo app (`mobile/apps/orca`) owns everything that is not slicing: file import, sending G-code, and fetching vendor profiles from the repository into the core's resources directory.

The façade owns all access to `Print`, `Model` and the preset bundle. The renderer (`OrcaViewportRenderer` in the Nitro package's `ios/` directory, Objective-C++ over Metal, shader compiled at runtime) never includes `libslic3r`; it reads the façade through `Session::mesh()` (an object's triangles in world space with per-face normals) and `Session::preview()` (the exported toolpath as one vertex per G-code move with libvgcode's segment convention, plus layer heights and tool colours). Geometry therefore never crosses the JavaScript boundary: the app holds handles and sends commands. The `OrcaViewport` Nitro View (Swift) receives a session id as a prop and finds the session in `SessionRegistry`, which hands out the façade under the session's mutex with `try_lock`, so a redraw during a slice keeps the last frame instead of blocking. Mode, layer range and a revision counter are props; the camera is native (orbit, two-finger pan, pinch, double-tap to fit).
