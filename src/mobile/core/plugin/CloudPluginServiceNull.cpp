#include <slic3r/plugin/CloudPluginService.hpp>

// The mobile core has no cloud agent: the app fetches the catalog and the packages itself
// (mobile/apps/orca/lib/plugins) and writes the same directories the desktop would. So the
// manager's cloud calls all answer "not here", and nothing it does depends on them.

namespace Slic3r {

namespace {
const char* MANAGED_BY_APP = "Orca Cloud plugins are managed by the app on this device.";
}

void CloudPluginService::set_cloud_agent(std::shared_ptr<OrcaCloudServiceAgent>) {}
std::shared_ptr<OrcaCloudServiceAgent> CloudPluginService::get_cloud_agent() const { return nullptr; }
std::string CloudPluginService::cloud_user_id() const { return {}; }
bool CloudPluginService::can_fetch_cloud_plugins() const { return false; }

bool CloudPluginService::fetch_manifests_into_descriptors(std::vector<PluginDescriptor>&, std::vector<std::string>&,
                                                          std::vector<std::string>&) const
{
    return false;
}

bool CloudPluginService::request_cloud_subscribe(const std::string&, std::string& error) const
{
    error = MANAGED_BY_APP;
    return false;
}

bool CloudPluginService::request_cloud_unsubscribe(const PluginDescriptor&, std::string& error) const
{
    error = MANAGED_BY_APP;
    return false;
}

bool CloudPluginService::download_cloud_plugin(PluginDescriptor&, const std::string&, CloudPluginDownload&, std::string& error) const
{
    error = MANAGED_BY_APP;
    return false;
}

bool CloudPluginService::fetch_plugin_changelog(const PluginDescriptor&, std::vector<PluginChangelog>&, std::string& error) const
{
    error = MANAGED_BY_APP;
    return false;
}

bool CloudPluginService::fetch_plugin_changelog(const std::vector<PluginDescriptor>&,
                                                std::unordered_map<std::string, std::vector<PluginChangelog>>&,
                                                std::string& error) const
{
    error = MANAGED_BY_APP;
    return false;
}

} // namespace Slic3r
