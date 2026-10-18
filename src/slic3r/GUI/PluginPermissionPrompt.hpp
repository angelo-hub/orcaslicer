#pragma once

#include <slic3r/plugin/PluginAuditManager.hpp>

namespace Slic3r::GUI {

// The desktop's answer to a plugin permission request: a yes/no dialog on the wx main thread.
// A request may arrive on a plugin load worker or inside a slicing-pipeline hook, so the call
// hops to the main thread and blocks for the answer. Installed by GUI_App::init_plugin_gui_wiring.
bool prompt_plugin_permission(const PluginPermissionRequest& request);

} // namespace Slic3r::GUI
