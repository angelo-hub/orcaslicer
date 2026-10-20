#include "../Plugins.hpp"
#include "PluginEvents.hpp"

#include <slic3r/plugin/PluginManager.hpp>
#include <slic3r/plugin/PythonPluginInterface.hpp>
#include <slic3r/plugin/pluginTypes/pages/PagesPluginCapability.hpp>

#include <boost/log/trivial.hpp>

#include <memory>

// The pages capability without a wx notebook: the app hosts the HTML in its own web
// view and relays both directions through the façade. A page the app has open holds the
// capability's message sender, so plugin.post_message() arrives as a page-message event.

namespace Slic3r { namespace Mobile { namespace Plugins {

namespace {

std::shared_ptr<PagesPluginCapability> page_capability(const std::string& key, const std::string& capability, std::string& error)
{
    auto cap = PluginManager::instance().get_plugin_capability(PluginCapabilityId{PluginCapabilityType::Pages, capability, key},
                                                               /*only_enabled=*/false);
    auto page = std::dynamic_pointer_cast<PagesPluginCapability>(cap);
    if (!page)
        error = "The plugin has no page called " + capability + " or is not loaded.";
    return page;
}

} // namespace

std::string page_html(const std::string& key, const std::string& capability, std::string& error)
{
    auto page = page_capability(key, capability, error);
    if (!page)
        return {};
    try {
        return page->get_ui();
    } catch (const std::exception& ex) {
        error = ex.what();
    } catch (...) {
        error = "The page could not be built.";
    }
    return {};
}

std::string page_icon(const std::string& key, const std::string& capability)
{
    std::string error;
    auto        page = page_capability(key, capability, error);
    if (!page)
        return {};
    try {
        return page->get_icon();
    } catch (...) {
        return {};
    }
}

std::string page_open(const std::string& key, const std::string& capability)
{
    std::string error;
    auto        page = page_capability(key, capability, error);
    if (!page)
        return error;
    page->set_message_sender([key, capability](const std::string& message) {
        plugin_events::emit({"page-message", key, capability, message});
    });
    return {};
}

void page_close(const std::string& key, const std::string& capability)
{
    std::string error;
    if (auto page = page_capability(key, capability, error))
        page->clear_message_sender();
}

std::string page_send(const std::string& key, const std::string& capability, const std::string& message_json)
{
    std::string error;
    auto        page = page_capability(key, capability, error);
    if (!page)
        return error;
    try {
        page->on_message(message_json);
    } catch (const std::exception& ex) {
        BOOST_LOG_TRIVIAL(error) << "Plugin page message handler failed for '" << capability << "': " << ex.what();
        return ex.what();
    } catch (...) {
        return "The page's message handler failed.";
    }
    return {};
}

}}} // namespace Slic3r::Mobile::Plugins
