if (MSVC)
    set(_patch_command ${CMAKE_COMMAND} -E copy ${CMAKE_CURRENT_LIST_DIR}/MSVC.cmake ./cmake/compilers/MSVC.cmake)
elseif (FLATPAK AND "${CMAKE_CXX_COMPILER_ID}" STREQUAL "GNU")
    set(_patch_command ${CMAKE_COMMAND} -E copy ${CMAKE_CURRENT_LIST_DIR}/GNU.cmake ./cmake/compilers/GNU.cmake)
else()
    set(_patch_command "")
endif()

# oneTBB v2021.5.0 unconditionally strips "-Werror" from CMAKE_CXX_FLAGS in
# cmake/compilers/Clang.cmake without accounting for the "-Werror=<warning>"
# form, so DEP_WERRORS_SDK's "-Werror=partial-availability" reaches the
# compiler as the malformed "=partial-availability" and every source file
# fails to compile. Clear the flags for TBB; the deployment target, sysroot
# and architecture still travel through their own variables, and TBB does
# not call SDK APIs the availability guard would catch.
set(_tbb_clear_flags "")
if (DEPS_IOS)
    set(_tbb_clear_flags
        "-DCMAKE_CXX_FLAGS="
        "-DCMAKE_C_FLAGS="
    )
endif ()

# With ANDROID_STL=c++_shared, oneTBB 2021.5 copies libc++_shared.so from
# sources/cxx-stl/llvm-libc++, a layout NDK r23 removed, and configure fails. A static
# archive links no STL, so TBB is told c++_static; the headers are the same libc++.
set(_tbb_android_stl "")
if (DEPS_ANDROID)
    set(_tbb_android_stl "-DANDROID_STL=c++_static")
endif ()

orcaslicer_add_cmake_project(
    TBB
    URL "https://github.com/oneapi-src/oneTBB/archive/refs/tags/v2021.5.0.zip"
    URL_HASH SHA256=83ea786c964a384dd72534f9854b419716f412f9d43c0be88d41874763e7bb47
    PATCH_COMMAND ${_patch_command}
    CMAKE_ARGS
        -DTBB_BUILD_SHARED=OFF
        -DTBB_BUILD_TESTS=OFF
        -DTBB_TEST=OFF
        -DTBB_DISABLE_HWLOC_AUTOMATIC_SEARCH=ON
        -DTBB_ENABLE_IPO=OFF
        -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF
        -DCMAKE_POSITION_INDEPENDENT_CODE=ON
        -DCMAKE_DEBUG_POSTFIX=_debug
        ${_tbb_clear_flags}
        ${_tbb_android_stl}
)

if (MSVC)
    add_debug_dep(dep_TBB)
endif ()


