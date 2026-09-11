# Mobile build of the slicing core

OrcaSlicer's slicing engine, `libslic3r`, has no dependency on wxWidgets or OpenGL. The mobile build packages that engine, plus a thin C++ façade, as a static library that a React Native app links through Nitro Modules. The desktop GUI is not part of it.

## What the build produces

`ORCA_MOBILE=ON` on the root CMake project builds:

- `libslic3r` and the in-tree libraries it links (`deps_src/`), unchanged.
- `libslic3r_mobile` (`src/mobile/core/`), the façade. It is the only public surface of the mobile library: plain C++17, no platform or toolkit includes, so the same code serves iOS and Android.

It does not build the GUI library, the CLI executable, the embedded Python runtime, the developer tools, sandboxes or tests. The in-tree libraries that only the GUI uses (`hidapi`, `imguizmo`, the `hints` tool) are skipped as well. Everything else in the root project is left as it is; when the option is off the desktop builds are unaffected.

`scripts/build_ios_core.sh` drives the two-stage build for iOS and merges the static archives of one or more slices (device, simulator) into `OrcaCore.xcframework`, whose headers are the façade's headers only.

## Dependencies

The dependency superbuild in `deps/` gains a platform file, `deps-ios.cmake`, selected when `CMAKE_SYSTEM_NAME` is `iOS`. It forwards the iOS description (system name, sysroot, architecture, deployment target) to every CMake-based dependency, since ExternalProject does not forward it, and sets the flags the autotools and OpenSSL recipes need. `DEPS_MOBILE`, forced on for iOS and available on any host, selects a dependency list that leaves out what the core does not link: wxWidgets, GLEW, GLFW, OpenCSG, libcurl, FFmpeg, Python and wxInspector. A desktop host builds that list to compile the core and run the façade tests natively.

Two constraints shape the recipes:

- CMake's built-in iOS support restricts `find_package` to the SDK. The deps prefix is added as a find root with mode `BOTH` so dependencies and the core still find each other, while `CMAKE_IGNORE_PREFIX_PATH` keeps host package managers out.
- Nothing built for iOS can execute on the build host, so no recipe may run a program it just compiled. The autotools recipes are configured with an explicit `--host` for the same reason.

## Layering above the core

The façade owns all access to `Print`, `Model` and the preset bundle. The renderer, when present under `src/mobile/render/`, exposes only its own vertex, camera and colour types and never includes `libslic3r`; the façade fills its buffers. Geometry therefore never crosses the JavaScript boundary: the app holds handles and sends commands.
