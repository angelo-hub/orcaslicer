project(NitroOrcaCore)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME NitroOrcaCore)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# The slicing core arrives as a prebuilt static archive per ABI, produced by
# scripts/build_android_core.sh -x (or the "Build Android core" workflow), with the
# façade's headers next to it. Copy build/android-core/ to android/libs/OrcaCore/, the
# counterpart of ios/OrcaCore.xcframework for the podspec; neither is committed.
set(ORCA_CORE_DIR "${CMAKE_SOURCE_DIR}/libs/OrcaCore" CACHE PATH "Directory holding <abi>/libOrcaCore.a and include/OrcaCore")
set(ORCA_CORE_ARCHIVE "${ORCA_CORE_DIR}/${ANDROID_ABI}/libOrcaCore.a")
if (NOT EXISTS "${ORCA_CORE_ARCHIVE}")
  message(FATAL_ERROR "${ORCA_CORE_ARCHIVE} not found. Build the core with scripts/build_android_core.sh -a ${ANDROID_ABI} -x and copy build/android-core to ${ORCA_CORE_DIR}.")
endif ()
add_library(OrcaCore STATIC IMPORTED)
set_target_properties(OrcaCore PROPERTIES
  IMPORTED_LOCATION "${ORCA_CORE_ARCHIVE}"
  INTERFACE_INCLUDE_DIRECTORIES "${ORCA_CORE_DIR}/include"
)

# The Hybrid Objects and the viewport's platform-neutral part (shared with iOS), plus
# the Android-specific sources.
file(GLOB_RECURSE shared_files RELATIVE ${CMAKE_SOURCE_DIR}
     "../cpp/**.cpp"
)
file(GLOB_RECURSE android_files RELATIVE ${CMAKE_SOURCE_DIR}
     "src/main/cpp/**.cpp"
)

add_library(${PACKAGE_NAME} SHARED
            ${shared_files}
            ${android_files}
)

# Add Nitrogen specs :)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroOrcaCore+autolinking.cmake)

include_directories(
        "src/main/cpp"
        "../cpp"
)

find_library(LOG_LIB log)

# The core is C++ only; zlib comes from the NDK, as the SDK supplies it on iOS.
target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        OrcaCore
        android
        z
)
