
# Android settings for the dependency superbuild.
#
# Included from deps/CMakeLists.txt when the NDK's toolchain file has set ANDROID. The
# caller passes
#   -DCMAKE_TOOLCHAIN_FILE=<ndk>/build/cmake/android.toolchain.cmake
#   -DANDROID_ABI=<one ABI, arm64-v8a or x86_64>
#   -DANDROID_PLATFORM=android-<minimum API level>
#   -DANDROID_STL=c++_shared
# scripts/build_android_core.sh is the intended driver and builds one ABI per invocation.
#
# Every dependency is built static. DEPS_MOBILE is forced on: the dependency list (see
# deps/CMakeLists.txt) leaves out the GUI, network-host and plugin libraries the slicing
# core does not link.

if (NOT ANDROID_ABI)
    message(FATAL_ERROR "Android deps: set ANDROID_ABI (arm64-v8a or x86_64)")
endif ()
if (NOT CMAKE_TOOLCHAIN_FILE)
    message(FATAL_ERROR "Android deps: pass the NDK's android.toolchain.cmake as CMAKE_TOOLCHAIN_FILE")
endif ()

set(DEPS_ANDROID TRUE)
# Only the core's dependencies exist for Android.
set(DEPS_MOBILE ON)

# The toolchain file resolves ANDROID_PLATFORM ("android-29", "29" or "latest") to the
# numeric level the compiler wrappers are named after: ANDROID_PLATFORM_LEVEL in the NDK's
# default (legacy) toolchain file, which leaves CMAKE_SYSTEM_VERSION at 1, and
# CMAKE_SYSTEM_VERSION in the one built on CMake's own Android support.
if (ANDROID_PLATFORM_LEVEL MATCHES "^[0-9]+$")
    set(DEPS_ANDROID_API "${ANDROID_PLATFORM_LEVEL}")
elseif (CMAKE_SYSTEM_VERSION MATCHES "^[0-9][0-9]+$")
    set(DEPS_ANDROID_API "${CMAKE_SYSTEM_VERSION}")
else ()
    message(FATAL_ERROR "Android deps: could not determine the API level from ANDROID_PLATFORM='${ANDROID_PLATFORM}'")
endif ()

if (ANDROID_ABI STREQUAL "arm64-v8a")
    set(TOOLCHAIN_PREFIX "aarch64-linux-android")
    set(DEPS_ANDROID_OPENSSL_TARGET "android-arm64")
elseif (ANDROID_ABI STREQUAL "x86_64")
    set(TOOLCHAIN_PREFIX "x86_64-linux-android")
    set(DEPS_ANDROID_OPENSSL_TARGET "android-x86_64")
else ()
    message(FATAL_ERROR "Android deps: unsupported ABI '${ANDROID_ABI}' (arm64-v8a or x86_64)")
endif ()

if (NOT ANDROID_STL)
    set(ANDROID_STL "c++_shared")
endif ()

# The NDK's LLVM toolchain, located from the compiler the toolchain file chose:
# <ndk>/toolchains/llvm/prebuilt/<host>/bin/clang. The recipes that do not go through
# CMake (GMP, MPFR, OpenSSL) need the tools by name: the per-API wrappers
# (<triple><api>-clang) carry --target and the sysroot, and the NDK ships no binutils
# under the <triple>-ar names autoconf derives from --host, only the llvm-* ones.
get_filename_component(DEPS_ANDROID_BIN "${CMAKE_C_COMPILER}" DIRECTORY)
set(DEPS_ANDROID_CC     "${DEPS_ANDROID_BIN}/${TOOLCHAIN_PREFIX}${DEPS_ANDROID_API}-clang")
set(DEPS_ANDROID_CXX    "${DEPS_ANDROID_BIN}/${TOOLCHAIN_PREFIX}${DEPS_ANDROID_API}-clang++")
set(DEPS_ANDROID_AR     "${DEPS_ANDROID_BIN}/llvm-ar")
set(DEPS_ANDROID_RANLIB "${DEPS_ANDROID_BIN}/llvm-ranlib")
set(DEPS_ANDROID_NM     "${DEPS_ANDROID_BIN}/llvm-nm")
set(DEPS_ANDROID_STRIP  "${DEPS_ANDROID_BIN}/llvm-strip")
foreach (_tool DEPS_ANDROID_CC DEPS_ANDROID_CXX DEPS_ANDROID_AR DEPS_ANDROID_RANLIB)
    if (NOT EXISTS "${${_tool}}")
        message(FATAL_ERROR "Android deps: ${${_tool}} not found in the NDK")
    endif ()
endforeach ()
# The autotools recipes pass these through env; OpenSSL's android-* targets find clang
# on PATH and the NDK through ANDROID_NDK_HOME instead.
set(DEPS_ANDROID_TOOL_ENV
    "AR=${DEPS_ANDROID_AR}"
    "RANLIB=${DEPS_ANDROID_RANLIB}"
    "NM=${DEPS_ANDROID_NM}"
    "STRIP=${DEPS_ANDROID_STRIP}"
)
if (ANDROID_NDK)
    set(DEPS_ANDROID_NDK "${ANDROID_NDK}")
elseif (CMAKE_ANDROID_NDK)
    set(DEPS_ANDROID_NDK "${CMAKE_ANDROID_NDK}")
else ()
    # <ndk>/toolchains/llvm/prebuilt/<host>/bin
    get_filename_component(DEPS_ANDROID_NDK "${DEPS_ANDROID_BIN}/../../../../.." ABSOLUTE)
endif ()

# ExternalProject forwards CMAKE_TOOLCHAIN_FILE but not the variables the toolchain
# file reads, so each CMake-based dependency gets the Android description here. CMake's
# Android support sets the CMAKE_FIND_ROOT_PATH_MODE_* variables to ONLY, which would
# hide the deps prefix from find_package; BOTH keeps the prefix visible while
# CMAKE_IGNORE_PREFIX_PATH still keeps host package managers out.
set(DEP_CMAKE_OPTS
    "-DANDROID_ABI=${ANDROID_ABI}"
    "-DANDROID_PLATFORM=android-${DEPS_ANDROID_API}"
    "-DANDROID_STL=${ANDROID_STL}"
    "-DCMAKE_FIND_ROOT_PATH=${DESTDIR}"
    "-DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=BOTH"
    "-DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=BOTH"
    "-DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH"
    "-DCMAKE_POSITION_INDEPENDENT_CODE=ON"
)

message(STATUS "Android deps: ndk=${DEPS_ANDROID_NDK} abi=${ANDROID_ABI} api=${DEPS_ANDROID_API} stl=${ANDROID_STL}")

include("deps-unix-common.cmake")
