#!/bin/bash
#
# Build the OrcaSlicer slicing core for Android.
#
# Two stages, mirroring build_ios_core.sh: the dependency superbuild in deps/, then the
# core (libslic3r + the mobile façade) against that prefix with ORCA_MOBILE=ON. One ABI
# per stage; -x merges every static archive into one libOrcaCore.a with the façade's
# headers next to it, which the Nitro module's android/CMakeLists.txt imports.
#
# Requires an Android NDK (r27 or newer), CMake >= 3.20, Ninja, autotools (MPFR runs
# autoreconf) and perl (OpenSSL); runs on macOS or Linux. The NDK is taken from
# ANDROID_NDK_ROOT or ANDROID_NDK_HOME, else the newest one under
# $ANDROID_HOME/ndk (or $ANDROID_SDK_ROOT/ndk, or the SDK's default location).
# Output layout:
#   deps/build/android-<abi>/OrcaSlicer_dep/usr/local   dependency prefix
#   build/android-<abi>/                                 core build tree
#   build/android-core/<abi>/libOrcaCore.a               merged output of -x
#   build/android-core/include/OrcaCore/*.hpp            the façade's headers

set -e
set -o pipefail
SECONDS=0

ABI="arm64-v8a"
API_LEVEL="29"
BUILD_TARGET="all"
BUILD_CONFIG="Release"
BUILD_ONLY=""
MERGE=""
RESUME=""
KEEP_DEBUG_INFO=""

usage() {
    echo "Usage: ./scripts/build_android_core.sh [options]"
    echo "   -d: Build deps only"
    echo "   -s: Build the core only (deps must exist)"
    echo "   -a: ABI: arm64-v8a or x86_64 (default: ${ABI})"
    echo "   -m: Minimum Android API level (default: ${API_LEVEL})"
    echo "   -c: CMake build configuration (default: ${BUILD_CONFIG})"
    echo "   -b: Build without reconfiguring CMake"
    echo "   -j: Parallel build jobs (CMAKE_BUILD_PARALLEL_LEVEL)"
    echo "   -r: Resume deps from a restored prefix and stamps without sources: every"
    echo "       dependency with a pending step is rebuilt from scratch"
    echo "   -x: After building, merge the archives into build/android-core/<abi>/libOrcaCore.a"
    echo "   -g: Keep debug info in the merged archive (the NDK compiles with -g; stripping"
    echo "       it takes the archive from several GB to a few hundred MB)"
    echo "   -h: This help"
}

while getopts ":dsa:m:c:bj:rxgh" opt; do
    case "${opt}" in
        d ) BUILD_TARGET="deps" ;;
        s ) BUILD_TARGET="core" ;;
        a ) ABI="$OPTARG" ;;
        m ) API_LEVEL="$OPTARG" ;;
        c ) BUILD_CONFIG="$OPTARG" ;;
        b ) BUILD_ONLY="1" ;;
        j ) export CMAKE_BUILD_PARALLEL_LEVEL="$OPTARG" ;;
        r ) RESUME="1" ;;
        x ) MERGE="1" ;;
        g ) KEEP_DEBUG_INFO="1" ;;
        h ) usage; exit 0 ;;
        * ) usage; exit 1 ;;
    esac
done

case "$ABI" in
    arm64-v8a | x86_64 ) ;;
    * ) echo "Unsupported ABI '$ABI' (arm64-v8a or x86_64)" >&2; exit 1 ;;
esac

case "$(uname -s)" in
    Darwin ) HOST_TAG="darwin-x86_64" ;;
    Linux )  HOST_TAG="linux-x86_64" ;;
    * ) echo "This script runs on macOS or Linux." >&2; exit 1 ;;
esac

for tool in cmake ninja autoreconf perl; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "$tool is required (macOS: brew install cmake ninja automake libtool; Debian: apt install cmake ninja-build autoconf automake libtool)." >&2
        exit 1
    fi
done

# find_ndk: honour an explicit NDK, else the newest one the SDK manager installed.
find_ndk() {
    if [ -n "${ANDROID_NDK_ROOT:-}" ]; then
        NDK="$ANDROID_NDK_ROOT"
    elif [ -n "${ANDROID_NDK_HOME:-}" ]; then
        NDK="$ANDROID_NDK_HOME"
    else
        local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
        if [ -z "$sdk" ]; then
            if [ "$(uname -s)" = "Darwin" ]; then
                sdk="$HOME/Library/Android/sdk"
            else
                sdk="$HOME/Android/Sdk"
            fi
        fi
        NDK=$(find "$sdk/ndk" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1)
        if [ -z "$NDK" ]; then
            echo "No Android NDK found under $sdk/ndk; set ANDROID_NDK_ROOT." >&2
            exit 1
        fi
    fi
    TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake"
    if [ ! -f "$TOOLCHAIN_FILE" ]; then
        echo "$TOOLCHAIN_FILE does not exist; is $NDK an NDK?" >&2
        exit 1
    fi
    NDK_BIN="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin"
    if [ ! -x "$NDK_BIN/llvm-ar" ]; then
        echo "$NDK_BIN/llvm-ar not found; the NDK does not match this host." >&2
        exit 1
    fi
}
find_ndk

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPS_DIR="$PROJECT_DIR/deps"
DEPS_BUILD_DIR="$DEPS_DIR/build/android-$ABI"
DEPS_PREFIX="$DEPS_BUILD_DIR/OrcaSlicer_dep/usr/local"
CORE_BUILD_DIR="$PROJECT_DIR/build/android-$ABI"
OUT_DIR="$PROJECT_DIR/build/android-core"
# Keep host package managers out of every find_package, as the iOS build does.
CMAKE_IGNORE_PREFIX_PATH="${CMAKE_IGNORE_PREFIX_PATH:-/opt/local:/usr/local:/opt/homebrew}"

# CMake 4 dropped compatibility with the pre-3.5 minimum versions some deps declare.
CMAKE_MAJOR=$(cmake --version | head -1 | sed 's/[^0-9]*\([0-9]*\).*/\1/')
CMAKE_POLICY_COMPAT=""
if [ "$CMAKE_MAJOR" -ge 4 ] 2>/dev/null; then
    export CMAKE_POLICY_VERSION_MINIMUM=3.5
    CMAKE_POLICY_COMPAT="-DCMAKE_POLICY_VERSION_MINIMUM=3.5"
fi

# The Android description every CMake invocation gets. c++_shared matches the React
# Native convention the final .so is linked with; for static archives the choice only
# selects headers, both are libc++.
ANDROID_CMAKE_ARGS=(
    -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN_FILE"
    -DANDROID_ABI="$ABI"
    -DANDROID_PLATFORM="android-$API_LEVEL"
    -DANDROID_STL=c++_shared
)

build_deps() {
    echo "Building deps for $ABI (API $API_LEVEL, $NDK)..."
    (
        set -x
        mkdir -p "$DEPS_BUILD_DIR"
        cd "$DEPS_BUILD_DIR"
        if [ "1" != "$BUILD_ONLY" ]; then
            # The superbuild itself keeps CMake's Android default of searching only the
            # NDK sysroot, so its find_package(ZLIB) finds the NDK's zlib and nothing
            # from the host; deps-android.cmake widens the search for each dependency.
            cmake "$DEPS_DIR" \
                -G Ninja \
                -DCMAKE_BUILD_TYPE="$BUILD_CONFIG" \
                "${ANDROID_CMAKE_ARGS[@]}" \
                -DCMAKE_IGNORE_PREFIX_PATH="$CMAKE_IGNORE_PREFIX_PATH" \
                $CMAKE_POLICY_COMPAT
        fi
        if [ "1" == "$RESUME" ]; then
            resume_deps
        fi
        # Keep going past a failing dependency so one run reports every failure.
        cmake --build . --target deps -- -k 0
    )
}

# resume_deps: the CI cache holds the installed prefix and the ExternalProject stamps
# of every dependency, not their source or build trees. A dependency that still has a
# step to run (it failed, its recipe changed, or something it depends on was rebuilt)
# cannot resume from that; it is removed so that it downloads and builds from scratch,
# while the untouched ones stay installed. Runs in the configured deps build directory.
resume_deps() {
    local pending
    pending=$(cmake --build . --target deps -- -n 2>/dev/null | grep -oE 'dep_[A-Za-z0-9]+-prefix' | sort -u || true)
    if [ -z "$pending" ]; then
        echo "Every dependency is up to date."
        return
    fi
    for prefix in $pending; do
        echo "Rebuilding ${prefix%-prefix} from scratch"
        rm -rf "$prefix"
    done
    # The superbuild's configure step writes the per-dependency command files that the
    # build reads from the removed directories; generate them again.
    cmake .
}

build_core() {
    if [ ! -d "$DEPS_PREFIX" ]; then
        echo "Deps prefix $DEPS_PREFIX does not exist; run without -s first." >&2
        exit 1
    fi
    echo "Building core for $ABI (API $API_LEVEL)..."
    (
        set -x
        mkdir -p "$CORE_BUILD_DIR"
        cd "$CORE_BUILD_DIR"
        if [ "1" != "$BUILD_ONLY" ]; then
            cmake "$PROJECT_DIR" \
                -G Ninja \
                -DCMAKE_BUILD_TYPE="$BUILD_CONFIG" \
                "${ANDROID_CMAKE_ARGS[@]}" \
                -DCMAKE_PREFIX_PATH="$DEPS_PREFIX" \
                -DCMAKE_FIND_ROOT_PATH="$DEPS_PREFIX" \
                -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=BOTH \
                -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=BOTH \
                -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH \
                -DCMAKE_IGNORE_PREFIX_PATH="$CMAKE_IGNORE_PREFIX_PATH" \
                -DORCA_MOBILE=ON \
                -DSLIC3R_GUI=0 \
                -DSLIC3R_PCH=0 \
                $CMAKE_POLICY_COMPAT
        fi
        cmake --build . --target libslic3r_mobile
    )
}

# merge_core <out.a>: one static archive with every object the façade needs, the same
# selection as the iOS merge.
merge_core() {
    local out="$1"
    local ar="$NDK_BIN/llvm-ar"

    # libjpeg-turbo installs libturbojpeg.a alongside libjpeg.a with the same
    # standard-libjpeg symbols; Qhull installs both a non-reentrant and a
    # reentrant static variant, but libslic3r only reaches for the reentrant
    # one through libqhullcpp. Skip the duplicates so the merge does not carry
    # two definitions of one symbol.
    local -a skip=( libturbojpeg.a libqhullstatic.a )

    # libqhullstatic_r.a and libqhullcpp.a both ship a default qh_fprintf
    # symbol (as a user-overridable stub); the C++ wrapper's copy is the one
    # libslic3r's callers use. Strip the C-side default.
    local qhull_r_slim=""
    if [ -f "$DEPS_PREFIX/lib/libqhullstatic_r.a" ]; then
        qhull_r_slim="$CORE_BUILD_DIR/libqhullstatic_r-slim.a"
        cp "$DEPS_PREFIX/lib/libqhullstatic_r.a" "$qhull_r_slim"
        "$ar" d "$qhull_r_slim" userprintf_r.c.o userprintf_rbox_r.c.o 2>/dev/null || true
        skip+=( libqhullstatic_r.a )
    fi

    # OCCT 8 installs its toolkits under lib/occt. A prefix restored from before that
    # move can still hold OCCT 7's libTK*.a at the top level, which must not be merged
    # with the newer headers the core compiled against.
    local occt_dir="$DEPS_PREFIX/lib/occt"

    # In-tree libraries live under src/ and deps_src/; a few — semver, today — land
    # in the build tree's top-level lib/ instead.
    local libs=()
    local candidate name skipthis
    while IFS= read -r candidate; do
        name=$(basename "$candidate")
        skipthis=""
        if [ -d "$occt_dir" ] && [ "$(dirname "$candidate")" = "$DEPS_PREFIX/lib" ] && [[ "$name" == libTK*.a ]]; then
            skipthis=1
        fi
        for s in "${skip[@]}"; do [ "$name" = "$s" ] && skipthis=1 && break; done
        [ -z "$skipthis" ] && libs+=("$candidate")
    done < <(
        find "$CORE_BUILD_DIR/src" "$CORE_BUILD_DIR/deps_src" "$CORE_BUILD_DIR/lib" \
            -name '*.a' -type f 2>/dev/null
        find "$DEPS_PREFIX/lib" -maxdepth 1 -name '*.a' -type f 2>/dev/null
        find "$occt_dir" -maxdepth 1 -name '*.a' -type f 2>/dev/null
    )
    [ -n "$qhull_r_slim" ] && libs+=("$qhull_r_slim")
    if [ "${#libs[@]}" -eq 0 ]; then
        echo "No static libraries found for $ABI" >&2
        exit 1
    fi
    echo "Merging ${#libs[@]} archives for $ABI into $out"
    rm -f "$out"
    # L adds the members of each input archive rather than the archive itself.
    "$ar" qcsL "$out" "${libs[@]}"
    # The NDK toolchain compiles with -g whatever the configuration, and the DWARF of a
    # hundred libraries makes the archive several GB. A prebuilt archive the app links
    # needs the symbols, not the debug info, so it is stripped unless asked otherwise.
    if [ "1" != "$KEEP_DEBUG_INFO" ]; then
        "$NDK_BIN/llvm-objcopy" --strip-debug "$out"
    fi
    echo "  $(wc -c < "$out" | tr -d ' ') bytes"
}

make_output() {
    local headers="$OUT_DIR/include/OrcaCore"
    mkdir -p "$headers" "$OUT_DIR/$ABI"
    rm -f "$headers"/*.hpp
    cp "$PROJECT_DIR/src/mobile/core/"*.hpp "$headers/"
    merge_core "$OUT_DIR/$ABI/libOrcaCore.a"
}

echo "Build params:"
echo " - ABI: $ABI"
echo " - API_LEVEL: $API_LEVEL"
echo " - NDK: $NDK"
echo " - BUILD_TARGET: $BUILD_TARGET"
echo " - BUILD_CONFIG: $BUILD_CONFIG"
echo " - CMAKE_IGNORE_PREFIX_PATH: $CMAKE_IGNORE_PREFIX_PATH"
echo

case "$BUILD_TARGET" in
    deps ) build_deps ;;
    core ) build_core ;;
    all )  build_deps; build_core ;;
esac

if [ "1" == "$MERGE" ]; then
    make_output
fi

echo "Done in $((SECONDS / 60))m $((SECONDS % 60))s"
