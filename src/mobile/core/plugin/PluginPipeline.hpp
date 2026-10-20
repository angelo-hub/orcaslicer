#pragma once

#include <string>

// The slicing-pipeline capability's G-code seam, called by Session::export_gcode. The
// geometry steps need no call site: PluginManager::initialize installs the Print hook
// that runs them inside Print::process(). This header may name libslic3r types, unlike
// the façade in ../Plugins.hpp.

namespace Slic3r {
class DynamicPrintConfig;
}

namespace Slic3r { namespace Mobile { namespace Plugins {

// Runs each configured slicing-pipeline plugin at Step.psGCodePostProcess on the exported
// file, in place, as GUI/PostProcessor.cpp does on the desktop. Throws std::runtime_error
// when a plugin fails or deletes the file; a no-op when the preset names no plugin or the
// core has no runtime.
void post_process_gcode(const std::string& gcode_path, const std::string& output_name, const DynamicPrintConfig& config);

}}} // namespace Slic3r::Mobile::Plugins
