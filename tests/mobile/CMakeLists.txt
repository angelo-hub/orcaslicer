get_filename_component(_TEST_NAME ${CMAKE_CURRENT_LIST_DIR} NAME)

# The mobile façade, run on the desktop host: an ORCA_MOBILE build with BUILD_TESTS.
add_executable(${_TEST_NAME}_tests
    ${_TEST_NAME}_tests.cpp
    test_session.cpp
    test_presets_io.cpp
    )

target_link_libraries(${_TEST_NAME}_tests test_common libslic3r_mobile Catch2::Catch2WithMain)
target_include_directories(${_TEST_NAME}_tests PRIVATE ${CMAKE_SOURCE_DIR}/src)
target_compile_definitions(${_TEST_NAME}_tests PRIVATE RESOURCES_DIR=R"\(${CMAKE_SOURCE_DIR}/resources\)")
set_property(TARGET ${_TEST_NAME}_tests PROPERTY FOLDER "tests")

orcaslicer_copy_test_dlls()

# The plugin host runs against the host Python the deps built (python3.cmake), copied
# next to the executable as the slic3rutils suite does.
if (ORCA_MOBILE_PLUGINS)
    target_sources(${_TEST_NAME}_tests PRIVATE test_plugins_host.cpp)
    target_link_libraries(${_TEST_NAME}_tests pybind11::embed)
    target_compile_definitions(${_TEST_NAME}_tests PRIVATE
        SANDBOXES_DIR=R"\(${CMAKE_SOURCE_DIR}/sandboxes\)"
        TEST_PYTHON_HOME=R"\($<TARGET_FILE_DIR:${_TEST_NAME}_tests>/python\)")
    if (APPLE)
        target_link_options(${_TEST_NAME}_tests PRIVATE "LINKER:-rpath,@executable_path/python/lib")
    endif ()
    add_custom_command(TARGET ${_TEST_NAME}_tests POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E rm -rf "$<TARGET_FILE_DIR:${_TEST_NAME}_tests>/python"
        COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_PREFIX_PATH}/libpython" "$<TARGET_FILE_DIR:${_TEST_NAME}_tests>/python"
        COMMENT "Copying the Python runtime for the mobile plugin host tests"
        VERBATIM
    )
endif ()

orcaslicer_discover_tests(${_TEST_NAME}_tests)
