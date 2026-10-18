#include <catch2/catch_test_macros.hpp>

#include "test_utils.hpp"

#include "mobile/core/OrcaMobile.hpp"
#include "mobile/core/Plugins.hpp"
#include "mobile/core/plugin/PluginEvents.hpp"

#include <boost/filesystem.hpp>
#include <nlohmann/json.hpp>

#include <chrono>
#include <fstream>
#include <string>

// The headless plugin host: the desktop's PluginManager driven through
// src/mobile/core/Plugins.hpp with no GUI. Built only with ORCA_MOBILE_PLUGINS, against
// the host Python the build copies next to the executable (see CMakeLists.txt).

using namespace Slic3r;
using namespace Slic3r::Mobile;
using json = nlohmann::json;
namespace fs = boost::filesystem;

namespace {

struct ScopedDataDir
{
    fs::path path;
    ScopedDataDir() : path(fs::temp_directory_path() / fs::unique_path("orca-mobile-plugins-%%%%-%%%%"))
    {
        fs::create_directories(path);
        set_directories(std::string(RESOURCES_DIR), path.string());
    }
    ~ScopedDataDir()
    {
        boost::system::error_code ec;
        fs::remove_all(path, ec);
    }
};

// One interpreter per process: initialize once, then every test only rescans.
std::string start_runtime(const std::string& cloud_user = "")
{
    const fs::path home = fs::path(TEST_PYTHON_HOME);
    return Plugins::initialize(home.string(), cloud_user);
}

// A local plugin: the sample script and a sidecar marking it installed and enabled.
std::string install_sample(const fs::path& data_dir, const std::string& key)
{
    const fs::path dir = data_dir / "orca_plugins" / key;
    fs::create_directories(dir);
    fs::copy_file(fs::path(SANDBOXES_DIR) / "orca_gcode_stamp_plugin_any.py", dir / "orca_gcode_stamp_plugin_any.py",
                  fs::copy_options::overwrite_existing);
    std::ofstream sidecar((dir / ".install_state.json").string());
    sidecar << json{{"installed_from", "local"},
                    {"installed_version", "0.01"},
                    {"plugin_name", "G-code Stamp"},
                    {"enabled", true},
                    {"permissions", json::object()},
                    {"capabilities", json::array()}}
                   .dump(2);
    return key;
}

json find_plugin(const std::string& name)
{
    for (const json& p : json::parse(Plugins::list_json()))
        if (p.value("name", "") == name)
            return p;
    return json();
}

} // namespace

TEST_CASE("the runtime starts and an empty data directory lists no plugins", "[Plugins]")
{
    ScopedDataDir dir;
    REQUIRE(Plugins::supported());
    REQUIRE(start_runtime().empty());
    REQUIRE(Plugins::discover().empty());
    CHECK(json::parse(Plugins::list_json()).empty());
    CHECK(Plugins::loaded_count() == 0);
}

TEST_CASE("a script plugin is discovered, loaded with its capability, and unloaded", "[Plugins]")
{
    ScopedDataDir dir;
    REQUIRE(start_runtime().empty());
    install_sample(dir.path, "stamp");
    REQUIRE(Plugins::discover().empty());

    json before = find_plugin("G-code Stamp");
    REQUIRE_FALSE(before.is_null());
    CHECK(before["loaded"] == false);
    CHECK(before["enabled"] == true);
    const std::string key = before["key"];

    REQUIRE(Plugins::load(key).empty());
    json loaded = find_plugin("G-code Stamp");
    CHECK(loaded["loaded"] == true);
    CHECK(Plugins::loaded_count() == 1);
    REQUIRE(loaded["capabilities"].size() == 1);
    CHECK(loaded["capabilities"][0]["name"] == "G-code Stamp");
    CHECK(loaded["capabilities"][0]["type"] == "slicing-pipeline");
    CHECK(loaded["capabilities"][0]["enabled"] == true);

    CHECK(Plugins::set_capability_enabled(key, "G-code Stamp", false).empty());
    CHECK(find_plugin("G-code Stamp")["capabilities"][0]["enabled"] == false);
    CHECK_FALSE(Plugins::set_capability_enabled(key, "no such capability", true).empty());

    REQUIRE(Plugins::unload(key));
    CHECK(find_plugin("G-code Stamp")["loaded"] == false);
    CHECK(Plugins::loaded_count() == 0);
}

TEST_CASE("loading an unknown plugin reports an error instead of throwing", "[Plugins]")
{
    ScopedDataDir dir;
    REQUIRE(start_runtime().empty());
    REQUIRE(Plugins::discover().empty());
    CHECK_FALSE(Plugins::load("missing").empty());
    CHECK_FALSE(Plugins::unload("missing"));
}

TEST_CASE("a permission grant lands in the plugin's sidecar and a revoke removes it", "[Plugins]")
{
    ScopedDataDir dir;
    REQUIRE(start_runtime().empty());
    install_sample(dir.path, "stamp");
    REQUIRE(Plugins::discover().empty());
    const std::string key = find_plugin("G-code Stamp")["key"];

    REQUIRE(Plugins::permission_grant(key, "network_http", "spoolman.local", true));
    const fs::path sidecar = dir.path / "orca_plugins" / key / ".install_state.json";
    json state = json::parse(std::ifstream(sidecar.string()));
    CHECK(state["permissions"]["network_http"] == json::array({"spoolman.local"}));

    REQUIRE(Plugins::permission_grant(key, "network_http", "spoolman.local", false));
    state = json::parse(std::ifstream(sidecar.string()));
    CHECK(state["permissions"]["network_http"].empty());

    CHECK_FALSE(Plugins::permission_grant(key, "not a category", "x", true));
    CHECK_FALSE(Plugins::permission_grant("missing", "network_http", "x", true));
}

TEST_CASE("an event with no sink is unanswered and one with a sink gets the answer", "[Plugins]")
{
    using namespace std::chrono_literals;
    plugin_events::set_sink(nullptr);
    CHECK_FALSE(plugin_events::ask({"ui-message", "", "", "{}"}, 10ms).has_value());

    long seen_id = 0;
    plugin_events::set_sink([&seen_id](const PluginEvent& e) {
        seen_id = e.request_id;
        plugin_events::answer(e.request_id, "allow");
    });
    const auto reply = plugin_events::ask({"permission-request", "p", "", "{}"}, 1s);
    REQUIRE(reply.has_value());
    CHECK(*reply == "allow");
    CHECK(seen_id != 0);

    // A sink that never answers: the wait runs out rather than hanging the plugin.
    plugin_events::set_sink([](const PluginEvent&) {});
    CHECK_FALSE(plugin_events::ask({"permission-request", "p", "", "{}"}, 10ms).has_value());
    plugin_events::set_sink(nullptr);
}

namespace {

// A pages plugin whose page echoes every message back through post_message.
const char* ECHO_PAGE_PLUGIN = R"PY(# /// script
# requires-python = ">=3.12"
#
# [tool.orcaslicer.plugin]
# name = "Echo Page"
# description = "A page that echoes messages (test)."
# author = "tests"
# version = "0.1"
# type = "pages"
# ///
import orca


class EchoPage(orca.pages.PagesPluginCapabilityBase):
    def get_name(self):
        return "Echo"

    def get_ui(self):
        return "<html><body>echo</body></html>"

    def on_message(self, data):
        self.post_message({"echo": data})


@orca.plugin
class EchoPackage(orca.base):
    def register_capabilities(self):
        orca.register_capability(EchoPage)
)PY";

void install_echo_page(const fs::path& data_dir)
{
    const fs::path dir = data_dir / "orca_plugins" / "echo";
    fs::create_directories(dir);
    std::ofstream(dir / "echo_page.py") << ECHO_PAGE_PLUGIN;
    std::ofstream((dir / ".install_state.json").string())
        << json{{"installed_from", "local"}, {"installed_version", "0.1"}, {"plugin_name", "Echo Page"},
                {"enabled", true}, {"permissions", json::object()}, {"capabilities", json::array()}}
               .dump(2);
}

} // namespace

TEST_CASE("a pages capability hands over its HTML and relays messages both ways", "[Plugins]")
{
    ScopedDataDir dir;
    REQUIRE(start_runtime().empty());
    install_echo_page(dir.path);
    REQUIRE(Plugins::discover().empty());
    const std::string key = find_plugin("Echo Page")["key"];
    REQUIRE(Plugins::load(key).empty());

    std::string error;
    CHECK(Plugins::page_html(key, "Echo", error).find("echo") != std::string::npos);
    CHECK(error.empty());
    CHECK(Plugins::page_html(key, "no such page", error).empty());
    CHECK_FALSE(error.empty());

    std::vector<PluginEvent> events;
    plugin_events::set_sink([&events](const PluginEvent& e) { events.push_back(e); });
    REQUIRE(Plugins::page_open(key, "Echo").empty());
    REQUIRE(Plugins::page_send(key, "Echo", R"({"spool": 3})").empty());
    REQUIRE(events.size() == 1);
    CHECK(events[0].kind == "page-message");
    CHECK(events[0].plugin_key == key);
    CHECK(events[0].capability == "Echo");
    CHECK(json::parse(events[0].payload_json) == json{{"echo", {{"spool", 3}}}});

    // With the page closed the plugin can still post, but nobody listens.
    Plugins::page_close(key, "Echo");
    REQUIRE(Plugins::page_send(key, "Echo", "1").empty());
    CHECK(events.size() == 1);
    plugin_events::set_sink(nullptr);
    REQUIRE(Plugins::unload(key));
}
