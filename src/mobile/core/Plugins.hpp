#pragma once

#include <functional>
#include <string>

// The Python plugin host, process-wide: one interpreter, one plugin registry, shared by
// every session. Compiled in when the core is built with ORCA_MOBILE_PLUGINS; otherwise a
// stub answers every call with "not supported" so the bridge has one shape either way.
//
// Calls that touch Python block, and one may wait on the app: a plugin that asks for a
// permission or shows a message raises an event through the sink and the host waits for
// answer(). So nothing here may run on the thread that delivers the answer.
//
// Errors come back as strings, empty for success, in the style of Session.

namespace Slic3r { namespace Mobile {

// What the host tells the app. `request_id` is non-zero when the host is waiting for
// answer(); the payload is JSON specific to `kind`:
//   permission-request  {plugin_name, event, category, targets[]}   answer: "allow" | "deny"
//   ui-message          {text, title, buttons, icon}                 answer: the button id
//   ui-progress         {id, title, message, value, maximum, open}   no answer
//   plugin-state        {}  (a plugin loaded or unloaded; re-read the list)
struct PluginEvent
{
    std::string kind;
    std::string plugin_key;
    std::string capability;
    std::string payload_json;
    long        request_id = 0;
};

namespace Plugins {

bool supported();

// Starts the interpreter and the registry. `python_home` holds lib/python3.x (the app
// bundle's python directory); `cloud_user_id` picks the _subscribed folder to scan.
// Returns an error, or empty.
std::string initialize(const std::string& python_home, const std::string& cloud_user_id);
void        set_cloud_user(const std::string& user_id);
// What orca.host.app_language() reports to plugins.
void        set_app_language(const std::string& language);

// Rescans the plugin directories. Returns the discovery error, or empty.
std::string discover();
// Every known plugin as a JSON array: key, name, version, installed_version, description,
// author, cloud_uuid, enabled, loaded, loading, error, dependencies[], capabilities[{name,
// type, enabled}].
std::string list_json();

// Loads with the plugin's declared pip dependencies skipped: nothing can install packages
// on the device. Blocks until the load finishes. Returns the load error, or empty.
std::string load(const std::string& key);
bool        unload(const std::string& key);
// Deletes the plugin's directory. Returns an error, or empty.
std::string remove(const std::string& key);
std::string set_capability_enabled(const std::string& key, const std::string& capability, bool enabled);

// Adds or removes one target from a permission list in the plugin's .install_state.json.
// `category` is fs_read, fs_readwrite, network_http, network_socket or process.
bool permission_grant(const std::string& key, const std::string& category, const std::string& target, bool granted);

void set_event_sink(std::function<void(const PluginEvent&)> sink);
void answer(long request_id, const std::string& answer);

int loaded_count();

} // namespace Plugins

}} // namespace Slic3r::Mobile
