get_filename_component(_TEST_NAME ${CMAKE_CURRENT_LIST_DIR} NAME)

# The mobile façade, run on the desktop host: an ORCA_MOBILE build with BUILD_TESTS. The
# viewport's platform-neutral part (the Nitro package's cpp/viewport) is compiled in as
# well; it includes the façade as <OrcaCore/Session.hpp>, the path the packaged core
# exports, which a forwarding header in the build tree resolves to the source.
set(_viewport_dir ${CMAKE_SOURCE_DIR}/mobile/packages/orca-core/cpp)
file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/include/OrcaCore/Session.hpp "#include \"mobile/core/Session.hpp\"\n")
add_executable(${_TEST_NAME}_tests
    ${_TEST_NAME}_tests.cpp
    test_session.cpp
    test_presets_io.cpp
    test_viewport.cpp
    ${_viewport_dir}/viewport/ViewportCamera.cpp
    ${_viewport_dir}/viewport/ViewportScene.cpp
    )

target_link_libraries(${_TEST_NAME}_tests test_common libslic3r_mobile Catch2::Catch2WithMain)
target_include_directories(${_TEST_NAME}_tests PRIVATE ${CMAKE_SOURCE_DIR}/src ${_viewport_dir} ${CMAKE_CURRENT_BINARY_DIR}/include)
target_compile_definitions(${_TEST_NAME}_tests PRIVATE RESOURCES_DIR=R"\(${CMAKE_SOURCE_DIR}/resources\)")
set_property(TARGET ${_TEST_NAME}_tests PROPERTY FOLDER "tests")

orcaslicer_copy_test_dlls()

orcaslicer_discover_tests(${_TEST_NAME}_tests)
