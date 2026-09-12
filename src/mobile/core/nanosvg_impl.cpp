// libslic3r parses SVGs with nanosvg but leaves the header-only implementation to the
// program that links it: the desktop GUI, the CLI tools and each test suite define it
// once. The mobile library is the whole program from libslic3r's point of view, so it
// carries the implementation.
#define NANOSVG_IMPLEMENTATION
#include "nanosvg.h"
#define NANOSVGRAST_IMPLEMENTATION
#include "nanosvgrast.h"
