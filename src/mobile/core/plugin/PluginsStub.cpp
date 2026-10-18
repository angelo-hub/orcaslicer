#include "../Plugins.hpp"

// The core without ORCA_MOBILE_PLUGINS: no interpreter, so every call says so.

namespace Slic3r { namespace Mobile { namespace Plugins {

namespace {
const char* NOT_SUPPORTED = "This build of the core has no Python plugin runtime.";
}

bool        supported() { return false; }
std::string initialize(const std::string&, const std::string&) { return NOT_SUPPORTED; }
void        set_cloud_user(const std::string&) {}
void        set_app_language(const std::string&) {}
std::string discover() { return NOT_SUPPORTED; }
std::string list_json() { return "[]"; }
std::string load(const std::string&) { return NOT_SUPPORTED; }
bool        unload(const std::string&) { return false; }
std::string remove(const std::string&) { return NOT_SUPPORTED; }
std::string set_capability_enabled(const std::string&, const std::string&, bool) { return NOT_SUPPORTED; }
bool        permission_grant(const std::string&, const std::string&, const std::string&, bool) { return false; }
void        set_event_sink(std::function<void(const PluginEvent&)>) {}
void        answer(long, const std::string&) {}
int         loaded_count() { return 0; }
std::string page_html(const std::string&, const std::string&, std::string& error)
{
    error = NOT_SUPPORTED;
    return {};
}
std::string page_icon(const std::string&, const std::string&) { return {}; }
std::string page_open(const std::string&, const std::string&) { return NOT_SUPPORTED; }
void        page_close(const std::string&, const std::string&) {}
std::string page_send(const std::string&, const std::string&, const std::string&) { return NOT_SUPPORTED; }

}}} // namespace Slic3r::Mobile::Plugins
