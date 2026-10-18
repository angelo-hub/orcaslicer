#include "PluginConfigResponses.hpp"

#include "GUI.hpp"
#include "I18N.hpp"
#include "format.hpp"

#include <slic3r/plugin/PluginManager.hpp>
#include <slic3r/plugin/PythonInterpreter.hpp>
#include <slic3r/plugin/PythonPluginInterface.hpp>

#include <boost/log/trivial.hpp>
#include <wx/utils.h>

namespace Slic3r {

// The replies PluginsConfigDialog sends its page. They call into the plugin under a busy
// cursor and word their errors for the user, which is why they live with the GUI rather than
// in PluginConfig.cpp.

// Config is sent as a JSON value, not text: the default editor pretty-prints it into its textarea,
// and a custom UI receives it as-is through window.orca.
nlohmann::json PluginConfig::get_config_response(const PluginCapabilityId& id)
{
    nlohmann::json response;
    response["command"]         = "capability_config";
    response["plugin_key"]      = id.plugin_key;
    response["capability_name"] = id.name;
    response["capability_type"] = plugin_capability_type_to_string(id.type);
    response["config"]          = nlohmann::json::object();
    response["custom_html"]     = "";
    response["error"]           = "";

    // Scoped to the full identity, so a stale request from a page that has not caught up with a
    // refresh misses rather than reading a different plugin's config.
    const auto cap = PluginManager::instance().get_plugin_capability(id, false);
    if (!cap) {
        BOOST_LOG_TRIVIAL(warning) << "Ignoring config request for a capability that is no longer loaded. plugin_key="
                                   << id.plugin_key << " capability_name=" << id.name;
        response["error"] = GUI::into_u8(_L("This capability is no longer available."));
        return response;
    }

    if (const auto stored = PluginManager::instance().get_config().get_config(id))
        response["config"] = stored->config;

    if (cap->config_ui_available()) {
        // A raising or empty get_config_ui() costs the capability only its custom UI: report the
        // failure and let the page fall back to the default JSON editor over the same stored config.
        std::string html;
        std::string error;
        {
            wxBusyCursor busy;
            try {
                PythonGILState gil;
                html = cap->get_config_ui();
            } catch (const std::exception& ex) {
                error = ex.what();
            } catch (...) {
                error = "Unknown error";
            }
        }

        if (!error.empty()) {
            BOOST_LOG_TRIVIAL(error) << "Plugin capability get_config_ui() failed. plugin_key=" << id.plugin_key
                                     << " capability_name=" << id.name << " error=" << error;
            response["error"] = GUI::into_u8(GUI::format_wxstr(_L("The plugin's configuration UI failed to load (%1%). Showing the default editor."),
                                                     GUI::from_u8(error)));
        } else if (html.empty()) {
            BOOST_LOG_TRIVIAL(warning) << "Plugin capability reports a config UI but returned no HTML. plugin_key=" << id.plugin_key
                                       << " capability_name=" << id.name;
            response["error"] = GUI::into_u8(_L("The plugin's configuration UI was empty. Showing the default editor."));
        } else {
            response["custom_html"] = html;
        }
    }

    return response;
}

nlohmann::json PluginConfig::save_config_response(const PluginCapabilityId& id, const nlohmann::json& config)
{
    nlohmann::json response;
    response["command"]         = "capability_config_saved";
    response["plugin_key"]      = id.plugin_key;
    response["capability_name"] = id.name;
    response["capability_type"] = plugin_capability_type_to_string(id.type);
    response["ok"]              = false;
    response["error"]           = "";

    const auto cap = PluginManager::instance().get_plugin_capability(id, false);
    if (!cap) {
        BOOST_LOG_TRIVIAL(warning) << "Refusing to save config for a capability that is no longer loaded. plugin_key="
                                   << id.plugin_key << " capability_name=" << id.name;
        response["error"] = GUI::into_u8(_L("This capability is no longer available. Your changes were not saved."));
        return response;
    }

    nlohmann::json parsed = config;
    if (config.is_string()) {
        // The page validates as the user types, but it is not the authority: re-parse so a malformed
        // document is rejected before it can reach config.json.
        parsed = nlohmann::json::parse(config.get<std::string>(), nullptr, /* allow_exceptions */ false);
        if (parsed.is_discarded()) {
            response["error"] = GUI::into_u8(_L("The configuration is not valid JSON. Your changes were not saved."));
            return response;
        }
    }

    if (!PluginManager::instance().get_config().store_capability_config(id, parsed)) {
        BOOST_LOG_TRIVIAL(error) << "Failed to write the plugin config file. plugin_key=" << id.plugin_key
                                 << " capability_name=" << id.name;
        response["error"] = GUI::into_u8(_L("The configuration could not be written to disk. Your changes were not saved."));
        return response;
    }

    BOOST_LOG_TRIVIAL(info) << "Saved plugin capability config. plugin_key=" << id.plugin_key << " capability_name=" << id.name;

    // Echo back what was persisted, not what the user typed, so the editor reloads from the store.
    response["ok"]     = true;
    if (const auto stored = PluginManager::instance().get_config().get_config(id))
        response["config"] = stored->config;
    return response;
}

// The host never invents the default: a capability that does not override get_default_config()
// restores an empty config, which is right for one that applies its own defaults on read.
nlohmann::json PluginConfig::restore_config_response(const PluginCapabilityId& id)
{
    nlohmann::json response;
    response["command"]         = "capability_config_saved";
    response["plugin_key"]      = id.plugin_key;
    response["capability_name"] = id.name;
    response["capability_type"] = plugin_capability_type_to_string(id.type);
    response["ok"]              = false;
    response["error"]           = "";

    const auto cap = PluginManager::instance().get_plugin_capability(id, false);
    if (!cap) {
        BOOST_LOG_TRIVIAL(warning) << "Refusing to restore config for a capability that is no longer loaded. plugin_key="
                                   << id.plugin_key << " capability_name=" << id.name;
        response["error"] = GUI::into_u8(_L("This capability is no longer available."));
        return response;
    }

    nlohmann::json defaults;
    std::string    error;
    {
        wxBusyCursor busy;
        try {
            PythonGILState gil;
            defaults = cap->get_default_config();
        } catch (const std::exception& ex) {
            error = ex.what();
        } catch (...) {
            error = "Unknown error";
        }
    }

    // A raising hook leaves the stored config as it was: better to restore nothing than to wipe the
    // user's settings on the strength of a broken plugin.
    if (!error.empty()) {
        BOOST_LOG_TRIVIAL(error) << "Plugin capability get_default_config() failed. plugin_key=" << id.plugin_key
                                 << " capability_name=" << id.name << " error=" << error;
        response["error"] = GUI::into_u8(GUI::format_wxstr(_L("The plugin could not supply a default configuration (%1%). "
                                                    "Nothing was changed."),
                                                 GUI::from_u8(error)));
        return response;
    }

    if (!PluginManager::instance().get_config().store_capability_config(id, defaults)) {
        BOOST_LOG_TRIVIAL(error) << "Failed to write the plugin config file while restoring defaults. plugin_key="
                                 << id.plugin_key << " capability_name=" << id.name;
        response["error"] = GUI::into_u8(_L("The configuration could not be written to disk. Nothing was changed."));
        return response;
    }

    BOOST_LOG_TRIVIAL(info) << "Restored default plugin capability config. plugin_key=" << id.plugin_key
                            << " capability_name=" << id.name;

    response["ok"]     = true;
    if (const auto stored = PluginManager::instance().get_config().get_config(id))
        response["config"] = stored->config;
    return response;
}

} // namespace Slic3r
