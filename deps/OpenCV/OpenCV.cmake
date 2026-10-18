# Intel IPP / IPP-ICV is x86/x64 only — there is no ARM64 build, so enabling it
# leaves ~200 unresolved ippicv* externals at link time on Windows ARM64.
if (MSVC AND NOT "${DEPS_ARCH}" STREQUAL "arm64")
    set(_use_IPP "-DWITH_IPP=ON")
    if (DEP_DEBUG)
        set(_options "FORWARD_CONFIG")
    endif ()
else ()
    set(_use_IPP "-DWITH_IPP=OFF")
    set(_options "")
endif ()

# carotene is OpenCV's ARM NEON HAL. It uses M_PI without _USE_MATH_DEFINES
# and does not compile with clang-cl.
set(_disable_carotene "")
if ("${DEPS_ARCH}" STREQUAL "arm64" AND CMAKE_CXX_COMPILER_ID STREQUAL Clang)
    set(_disable_carotene "-DWITH_CAROTENE=OFF")
endif ()

if (IN_GIT_REPO)
    set(OpenCV_DIRECTORY_FLAG --directory ${BINARY_DIR_REL}/dep_OpenCV-prefix/src/dep_OpenCV)
endif ()

# Only the image modules are used; keep the camera and framework packaging off on iOS.
set(_opencv_ios_args "")
if (DEPS_IOS)
    set(_opencv_ios_args
        -DAPPLE_FRAMEWORK=OFF
        -DWITH_AVFOUNDATION=OFF
        -DWITH_CAP_IOS=OFF
        -DBUILD_opencv_videoio=OFF
    )
endif ()

# OpenCV's Android build wants the SDK for its Java projects and installs into an
# sdk/native/<abi> tree. The core needs the image modules only, in the usual unix prefix
# layout so find_package(OpenCV) and the archive merge see the same paths as on iOS.
set(_opencv_android_args "")
if (DEPS_ANDROID)
    set(_opencv_android_args
        -DBUILD_ANDROID_PROJECTS=OFF
        -DBUILD_ANDROID_EXAMPLES=OFF
        -DBUILD_ANDROID_SERVICE=OFF
        -DWITH_ANDROID_MEDIANDK=OFF
        -DBUILD_opencv_videoio=OFF
        -DOPENCV_BIN_INSTALL_PATH=bin
        -DOPENCV_TEST_INSTALL_PATH=bin
        -DOPENCV_SAMPLES_BIN_INSTALL_PATH=bin
        -DOPENCV_LIB_INSTALL_PATH=lib
        -DOPENCV_LIB_ARCHIVE_INSTALL_PATH=lib
        -DOPENCV_3P_LIB_INSTALL_PATH=lib/opencv4/3rdparty
        -DOPENCV_CONFIG_INSTALL_PATH=lib/cmake/opencv4
        -DOPENCV_INCLUDE_INSTALL_PATH=include/opencv4
        -DOPENCV_OTHER_INSTALL_PATH=share/opencv4
        -DOPENCV_SAMPLES_SRC_INSTALL_PATH=share/opencv4/samples
        -DOPENCV_LICENSES_INSTALL_PATH=share/licenses/opencv4
        -DOPENCV_TEST_DATA_INSTALL_PATH=share/opencv4/testdata
        -DOPENCV_DOC_INSTALL_PATH=share/doc/opencv4
    )
endif ()

orcaslicer_add_cmake_project(OpenCV
    ${_options}
    URL https://github.com/opencv/opencv/archive/refs/tags/4.6.0.tar.gz
    URL_HASH SHA256=1ec1cba65f9f20fe5a41fda1586e01c70ea0c9a6d7b67c9e13edf0cfe2239277
    PATCH_COMMAND git apply ${OpenCV_DIRECTORY_FLAG} --verbose --ignore-space-change --whitespace=fix ${CMAKE_CURRENT_LIST_DIR}/0001-vs.patch  ${CMAKE_CURRENT_LIST_DIR}/0002-clang19-macos.patch
    CMAKE_ARGS
    -DBUILD_SHARED_LIBS=0
       -DBUILD_PERE_TESTS=OFF
       -DBUILD_TESTS=OFF
       -DBUILD_opencv_python_tests=OFF
       -DBUILD_EXAMPLES=OFF
       -DBUILD_JASPER=OFF
       -DBUILD_JAVA=OFF
       -DBUILD_JPEG=ON
       -DBUILD_APPS_LIST=version
       -DBUILD_opencv_apps=OFF
       -DBUILD_opencv_java=OFF
       -DBUILD_OPENEXR=OFF
       -DBUILD_PNG=ON
       -DBUILD_TBB=OFF
       -DBUILD_WEBP=OFF
       -DBUILD_ZLIB=OFF
       -DWITH_1394=OFF
       -DWITH_CUDA=OFF
       -DWITH_EIGEN=OFF
       ${_use_IPP}
       -DWITH_ITT=OFF
       -DWITH_FFMPEG=OFF
       -DWITH_GPHOTO2=OFF
       -DWITH_GSTREAMER=OFF
       -DOPENCV_GAPI_GSTREAMER=OFF
       -DWITH_GTK_2_X=OFF
       -DWITH_JASPER=OFF
       -DWITH_LAPACK=OFF
       -DWITH_MATLAB=OFF
       -DWITH_MFX=OFF
       -DWITH_DIRECTX=OFF
       -DWITH_DIRECTML=OFF
       -DWITH_OPENCL=OFF
       -DWITH_OPENCL_D3D11_NV=OFF
       -DWITH_OPENCLAMDBLAS=OFF
       -DWITH_OPENCLAMDFFT=OFF
       -DWITH_OPENEXR=OFF
       -DWITH_OPENJPEG=OFF
       -DWITH_QUIRC=OFF
       -DWITH_VTK=OFF
       -DWITH_JPEG=OFF
       -DWITH_WEBP=OFF
       -DWITH_TIFF=OFF
       -DBUILD_TIFF=OFF
       -DENABLE_PRECOMPILED_HEADERS=OFF
       -DINSTALL_TESTS=OFF
       -DINSTALL_C_EXAMPLES=OFF
       -DINSTALL_PYTHON_EXAMPLES=OFF
       -DOPENCV_GENERATE_SETUPVARS=OFF
       -DOPENCV_INSTALL_FFMPEG_DOWNLOAD_SCRIPT=OFF
       -DBUILD_opencv_python2=OFF
       -DBUILD_opencv_python3=OFF
       -DWITH_OPENVINO=OFF
       -DWITH_INF_ENGINE=OFF
       -DWITH_NGRAPH=OFF
       -DBUILD_WITH_STATIC_CRT=OFF#set /MDd /MD
       -DBUILD_LIST=core,imgcodecs,imgproc,world
       -DBUILD_opencv_highgui=OFF
       -DWITH_ADE=OFF
       -DBUILD_opencv_world=ON
       -DWITH_PROTOBUF=OFF
       -DWITH_WIN32UI=OFF
       -DHAVE_WIN32UI=FALSE
       ${_disable_carotene}
       ${_opencv_ios_args}
       ${_opencv_android_args}
)

