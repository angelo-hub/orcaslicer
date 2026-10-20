#pragma once

// The plugin core is also built into the mobile core, which has no wxWidgets. There its
// messages go through libslic3r's translation hook, and GUI::format is libslic3r's format,
// so the core keeps the desktop's _u8L / GUI::format call sites unchanged.
#ifdef ORCA_MOBILE_PLUGINS
#include "libslic3r/I18N.hpp"
#include "libslic3r/format.hpp"

namespace Slic3r::GUI {
using Slic3r::format;
} // namespace Slic3r::GUI
#else
#include "slic3r/GUI/I18N.hpp"
#include "slic3r/GUI/format.hpp"
#endif
