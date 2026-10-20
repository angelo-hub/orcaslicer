# CPython for iOS, prebuilt by BeeWare's Python-Apple-support: a dynamic Python.framework
# per slice with its headers, the per-arch extension modules as .so files, and one shared
# pure-Python stdlib. Nothing is compiled here. The archive unpacks as Python.xcframework
# and goes into the prefix whole: the core build reads the headers from it, the app vendors
# it, and its build/utils.sh turns the stdlib's .so modules into frameworks iOS can load.
#
# The desktop embeds 3.12 (python3.cmake); plugins declare requires-python >= 3.12, so a
# newer runtime here runs the same packages.
set(_python_ios_release "3.14-b12")
set(_python_ios_archive "Python-3.14-iOS-support.b12.tar.gz")

ExternalProject_Add(dep_python3
    URL "https://github.com/beeware/Python-Apple-support/releases/download/${_python_ios_release}/${_python_ios_archive}"
    URL_HASH SHA256=157a6b956f47a12f005ad1e23e3e264536ef06dd35e1366acb48edbaa128e0a3
    DOWNLOAD_DIR ${DEP_DOWNLOAD_DIR}/python3
    CONFIGURE_COMMAND ""
    BUILD_COMMAND ""
    # The archive holds Python.xcframework next to a VERSIONS file and a testbed project;
    # only the framework is wanted.
    INSTALL_COMMAND ${CMAKE_COMMAND} -E rm -rf ${DESTDIR}/Python.xcframework
            COMMAND ${CMAKE_COMMAND} -E copy_directory <SOURCE_DIR>/Python.xcframework ${DESTDIR}/Python.xcframework
)
