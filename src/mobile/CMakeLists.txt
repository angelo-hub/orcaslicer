cmake_minimum_required(VERSION 3.13)
project(libslic3r_mobile)

# The mobile façade: the C++ surface the React Native bridge (Nitro Modules) wraps.
# Pure C++17, no platform or UI toolkit includes, so the same library serves iOS and
# Android. Rendering lives in a separate library under render/ and is added by the
# platform build once it exists.

add_library(libslic3r_mobile STATIC
    core/OrcaMobile.cpp
    core/OrcaMobile.hpp
    core/PresetArchive.cpp
    core/PresetArchive.hpp
    core/Session.cpp
    core/Session.hpp
    core/Thumbnails.cpp
    core/Thumbnails.hpp
    core/UndoStack.cpp
    core/UndoStack.hpp
)

target_include_directories(libslic3r_mobile PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# The upstream commit the core is based on (see upstream_commit()). Reconfigure when the
# sync updates it, so the define never goes stale.
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/upstream-commit.txt)
file(STRINGS ${CMAKE_CURRENT_SOURCE_DIR}/upstream-commit.txt ORCA_UPSTREAM_COMMIT LIMIT_COUNT 1 REGEX "^[0-9a-f]+$")
set_source_files_properties(core/OrcaMobile.cpp PROPERTIES
    COMPILE_DEFINITIONS "ORCA_UPSTREAM_COMMIT=\"${ORCA_UPSTREAM_COMMIT}\"")
target_link_libraries(libslic3r_mobile
    PUBLIC  libslic3r
    PRIVATE nlohmann_json
)

if (COMMAND encoding_check)
    encoding_check(libslic3r_mobile)
endif ()
