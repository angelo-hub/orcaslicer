#include "../Plugins.hpp"
#include "PluginEvents.hpp"

#include <slic3r/plugin/PluginAuditManager.hpp>
#include <slic3r/plugin/PluginDescriptor.hpp>
#include <slic3r/plugin/PluginFsUtils.hpp>
#include <slic3r/plugin/PluginManager.hpp>
#include <slic3r/plugin/PythonInterpreter.hpp>
#include <slic3r/plugin/PythonPluginInterface.hpp>

#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>
#include <nlohmann/json.hpp>

#include <chrono>
#include <mutex>

// The desktop's PluginManager driven without a GUI. The seams GUI_App fills in with wx
// (init_plugin_gui_wiring) are filled here with the event channel: permission prompts
// become permission-request events the app answers, lifecycle callbacks run inline on the
// worker that finished (no main thread to hop to), and the cloud service is the null one
// in CloudPluginServiceNull.cpp, since the app owns the catalog.

namespace Slic3r { namespace Mobile { namespace Plugins {

namespace {

using json = nlohmann::json;
using namespace std::chrono_literals;

constexpr auto PERMISSION_WAIT = 120s;
constexpr auto LOAD_WAIT       = 120s;

std::mutex  s_mutex;
std::string s_app_language = "en";
bool        s_initialized  = false;

const char* category_name(AuditEventCategory category)
{
    switch (category) {
    case AuditEventCategory::FsRead: return "fs_read";
    case AuditEventCategory::FsReadWrite: return "fs_readwrite";
    case AuditEventCategory::FsCreate: return "fs_create";
    case AuditEventCategory::FsDelete: return "fs_delete";
    case AuditEventCategory::Http: return "network_http";
    case AuditEventCategory::Socket: return "network_socket";
    case AuditEventCategory::ProcessCreate: return "process";
    case AuditEventCategory::Threading: return "threading";
    default: return "none";
    }
}

// The permission policy: a process can never be spawned on iOS, so that is denied without
// asking; everything else goes to the app, which persists an allow through the manager.
bool prompt_permission(const PluginPermissionRequest& request)
{
    if (request.category == AuditEventCategory::ProcessCreate)
        return false;
    const json payload = {
        {"plugin_name", request.plugin_name},
        {"event", request.event_name},
        {"category", category_name(request.category)},
        {"targets", request.targets},
    };
    const auto reply = plugin_events::ask({"permission-request", request.plugin_key, "", payload.dump()}, PERMISSION_WAIT);
    return reply.has_value() && *reply == "allow";
}

std::vector<std::string>* permission_list(PluginPermissions& permissions, const std::string& category)
{
    if (category == "fs_read") return &permissions.fs_read;
    if (category == "fs_readwrite") return &permissions.fs_readwrite;
    if (category == "network_http") return &permissions.network_http;
    if (category == "network_socket") return &permissions.network_socket;
    if (category == "process") return &permissions.process;
    return nullptr;
}

} // namespace

bool supported() { return true; }

std::string app_language() { return s_app_language; }

std::string initialize(const std::string& python_home, const std::string& cloud_user_id)
{
    std::lock_guard<std::mutex> lock(s_mutex);
    PluginManager& manager = PluginManager::instance();
    if (s_initialized) {
        manager.set_cloud_user(cloud_user_id);
        return {};
    }

    PythonInterpreter::set_python_home_override(python_home);
    PluginManager::set_main_thread_dispatcher(nullptr);
    PluginAuditManager::set_permission_prompt(&prompt_permission);
    manager.set_cloud_user(cloud_user_id);
    if (!manager.initialize()) {
        const std::string error = PythonInterpreter::instance().last_error();
        return error.empty() ? "The Python runtime could not start." : error;
    }
    manager.subscribe_on_load_callback([](const std::string& key) { plugin_events::emit({"plugin-state", key, "", "{}"}); });
    manager.subscribe_on_unload_callback([](const std::string& key) { plugin_events::emit({"plugin-state", key, "", "{}"}); });
    s_initialized = true;
    return {};
}

void set_cloud_user(const std::string& user_id) { PluginManager::instance().set_cloud_user(user_id); }

void set_app_language(const std::string& language)
{
    std::lock_guard<std::mutex> lock(s_mutex);
    s_app_language = language;
}

std::string discover()
{
    if (!s_initialized)
        return "The plugin runtime is not initialized.";
    PluginManager& manager = PluginManager::instance();
    manager.discover_plugins(false, true);
    return manager.get_discovery_error();
}

std::string list_json()
{
    json out = json::array();
    if (!s_initialized)
        return out.dump();
    PluginManager& manager = PluginManager::instance();
    for (const PluginDescriptor& d : manager.get_plugin_descriptors(true)) {
        json caps = json::array();
        for (const auto& cap : manager.get_plugin_capabilities(d.plugin_key, PluginCapabilityType::Unknown, false)) {
            caps.push_back({
                {"name", cap->name()},
                {"type", plugin_capability_type_to_string(cap->type())},
                {"enabled", cap->is_enabled()},
            });
        }
        std::string error = d.normalized_error();
        if (error.empty())
            error = manager.get_plugin_load_error(d.plugin_key);
        out.push_back({
            {"key", d.plugin_key},
            {"name", d.name},
            {"version", d.version},
            {"installed_version", d.installed_version},
            {"description", d.description},
            {"author", d.author},
            {"cloud_uuid", d.cloud_uuid()},
            {"enabled", d.enabled},
            {"loaded", manager.is_plugin_loaded(d.plugin_key)},
            {"loading", manager.is_plugin_load_in_progress(d.plugin_key)},
            {"error", error},
            {"dependencies", d.dependencies},
            {"capabilities", std::move(caps)},
        });
    }
    return out.dump();
}

std::string load(const std::string& key)
{
    if (!s_initialized)
        return "The plugin runtime is not initialized.";
    PluginManager& manager = PluginManager::instance();
    if (manager.is_plugin_loaded(key))
        return {};
    PluginDescriptor descriptor;
    if (!manager.try_get_plugin_descriptor(key, descriptor))
        return "The plugin is not installed.";

    manager.load_plugin(key, /*skip_deps=*/true);
    std::string error;
    if (!manager.wait_for_plugin_load(key, LOAD_WAIT, error) && error.empty())
        error = "The plugin did not finish loading in time.";
    if (error.empty())
        error = manager.get_plugin_load_error(key);
    // Packages cannot be installed on the device, so a missing module is most likely one
    // the plugin declared; say so rather than leave a bare traceback.
    if (!error.empty() && !descriptor.dependencies.empty() && error.find("No module named") != std::string::npos) {
        std::string deps;
        for (const std::string& dep : descriptor.dependencies)
            deps += (deps.empty() ? "" : ", ") + dep;
        error += "\n\nThis plugin needs Python packages (" + deps +
                 ") that cannot be installed on this device. Only plugins without package dependencies run here.";
    }
    return error;
}

bool unload(const std::string& key) { return s_initialized && PluginManager::instance().unload_plugin(key); }

std::string remove(const std::string& key)
{
    if (!s_initialized)
        return "The plugin runtime is not initialized.";
    std::string error;
    if (!PluginManager::instance().delete_plugin(key, error) && error.empty())
        error = "The plugin could not be removed.";
    return error;
}

std::string set_capability_enabled(const std::string& key, const std::string& capability, bool enabled)
{
    if (!s_initialized)
        return "The plugin runtime is not initialized.";
    PluginManager& manager = PluginManager::instance();
    for (const auto& cap : manager.get_plugin_capabilities(key, PluginCapabilityType::Unknown, false)) {
        if (cap->name() != capability)
            continue;
        manager.set_capability_enabled(PluginCapabilityId{cap->type(), cap->name(), key}, enabled);
        return {};
    }
    return "The plugin has no capability called " + capability + ".";
}

bool permission_grant(const std::string& key, const std::string& category, const std::string& target, bool granted)
{
    if (!s_initialized)
        return false;
    PluginManager&   manager = PluginManager::instance();
    PluginDescriptor descriptor;
    if (!manager.try_get_plugin_descriptor(key, descriptor) || descriptor.plugin_root.empty())
        return false;
    PluginInstallState state;
    if (!manager.get_install_state(key, state))
        return false;
    std::vector<std::string>* list = permission_list(state.permissions, category);
    if (list == nullptr)
        return false;
    const auto it = std::find(list->begin(), list->end(), target);
    if (granted && it == list->end())
        list->push_back(target);
    else if (!granted && it != list->end())
        list->erase(it);
    else
        return true;
    return write_install_state(boost::filesystem::path(descriptor.plugin_root), state);
}

void set_event_sink(std::function<void(const PluginEvent&)> sink) { plugin_events::set_sink(std::move(sink)); }

void answer(long request_id, const std::string& value) { plugin_events::answer(request_id, value); }

std::string check_preset_refs(const std::string& refs_json)
{
    json out  = json::array();
    json refs = json::parse(refs_json, nullptr, false);
    if (!refs.is_array())
        return out.dump();
    PluginManager& manager = PluginManager::instance();
    for (const json& ref : refs) {
        if (!ref.is_object())
            continue;
        const std::string uuid       = ref.value("uuid", "");
        const std::string name       = ref.value("name", "");
        const std::string capability = ref.value("capability", "");
        const std::string key        = uuid.empty() ? name : uuid;
        std::string       state      = "missing";
        PluginDescriptor  descriptor;
        if (s_initialized && manager.try_get_plugin_descriptor(key, descriptor)) {
            if (!manager.is_plugin_loaded(key))
                state = descriptor.has_error() ? "error" : "installed";
            else if (auto cap = manager.get_plugin_capability(capability, PluginCapabilityType::Unknown, false))
                state = cap->is_enabled() ? "loaded" : "disabled";
            else
                state = "error";
        }
        out.push_back({{"uuid", uuid}, {"capability", capability}, {"state", state}});
    }
    return out.dump();
}

std::string run_script(const std::string& key, const std::string& capability)
{
    json out = {{"status", "fatal_error"}, {"message", ""}, {"data", ""}, {"error", ""}};
    if (!s_initialized) {
        out["error"] = "The plugin runtime is not initialized.";
        return out.dump();
    }
    std::string     error;
    ExecutionResult result = PluginManager::instance().run_script_capability(key, capability, error);
    if (error.empty() && !PluginManager::instance().get_plugin_capability(
                             PluginCapabilityId{PluginCapabilityType::Script, capability, key}, false))
        error = "The plugin has no script called " + capability + " or is not loaded.";
    switch (result.status) {
    case PluginResult::Success: out["status"] = "success"; break;
    case PluginResult::Skipped: out["status"] = "skipped"; break;
    case PluginResult::RecoverableError: out["status"] = "recoverable_error"; break;
    case PluginResult::FatalError: out["status"] = "fatal_error"; break;
    }
    out["message"] = result.message;
    out["data"]    = result.data;
    out["error"]   = error;
    return out.dump();
}

int loaded_count()
{
    if (!s_initialized)
        return 0;
    int            count   = 0;
    PluginManager& manager = PluginManager::instance();
    for (const PluginDescriptor& d : manager.get_plugin_descriptors(true))
        if (manager.is_plugin_loaded(d.plugin_key))
            ++count;
    return count;
}

}}} // namespace Slic3r::Mobile::Plugins
