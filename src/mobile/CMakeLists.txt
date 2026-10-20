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

# The Python plugin host (ORCA_MOBILE_PLUGINS): the desktop's plugin layer minus the files
# that need wx, plus this directory's replacements for what those provided. Off, a stub
# answers every call with "not supported" so the bridge keeps one shape.
if (ORCA_MOBILE_PLUGINS)
    set(_plugin_dir ${CMAKE_SOURCE_DIR}/src/slic3r/plugin)
    target_sources(libslic3r_mobile PRIVATE
        core/Plugins.hpp
        core/plugin/Plugins.cpp
        core/plugin/PluginEvents.cpp
        core/plugin/PluginEvents.hpp
        core/plugin/CloudPluginServiceNull.cpp
        core/plugin/PluginHostAppMobile.cpp
        core/plugin/PluginHostUiMobile.cpp
        core/plugin/PluginPages.cpp
        core/plugin/PluginPipeline.cpp
        core/plugin/PluginPipeline.hpp
        core/plugin/PluginPrinterAgent.cpp
        ${_plugin_dir}/PluginAuditManager.cpp
        ${_plugin_dir}/PluginConfig.cpp
        ${_plugin_dir}/PluginFsUtils.cpp
        ${_plugin_dir}/PluginHooks.cpp
        ${_plugin_dir}/PluginLoader.cpp
        ${_plugin_dir}/PluginManager.cpp
        ${_plugin_dir}/PythonInterpreter.cpp
        ${_plugin_dir}/PythonPluginBridge.cpp
        ${_plugin_dir}/host/PluginHost.cpp
        ${_plugin_dir}/host/PluginHostGeometry.cpp
        ${_plugin_dir}/host/PluginHostMesh.cpp
        ${_plugin_dir}/host/PluginHostModel.cpp
        ${_plugin_dir}/host/PluginHostPresets.cpp
        ${_plugin_dir}/host/PluginHostSlicing.cpp
        ${_plugin_dir}/pluginTypes/pages/PagesPluginCapability.cpp
        ${_plugin_dir}/pluginTypes/printerAgent/PrinterAgentPluginCapability.cpp
        ${_plugin_dir}/pluginTypes/resourceTexture/ResourceTexturePluginCapability.cpp
        ${_plugin_dir}/pluginTypes/script/ScriptPluginCapability.cpp
        ${_plugin_dir}/pluginTypes/slicingPipeline/SlicingPipelinePluginCapability.cpp
    )
    # The plugin files include their siblings as <slic3r/plugin/...> and IPrinterAgent.hpp bare.
    target_include_directories(libslic3r_mobile PRIVATE ${CMAKE_SOURCE_DIR}/src ${CMAKE_SOURCE_DIR}/src/slic3r/Utils)
    target_compile_definitions(libslic3r_mobile PUBLIC ORCA_MOBILE_PLUGINS=1)
    target_link_libraries(libslic3r_mobile PRIVATE pybind11::embed)
else ()
    target_sources(libslic3r_mobile PRIVATE core/Plugins.hpp core/plugin/PluginsStub.cpp)
endif ()

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
