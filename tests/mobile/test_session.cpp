#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "test_utils.hpp"

#include "mobile/core/OrcaMobile.hpp"
#include "mobile/core/Session.hpp"

#include <nlohmann/json.hpp>

#include <boost/filesystem.hpp>

#include <algorithm>
#include <fstream>
#include <string>

using namespace Slic3r;
using namespace Slic3r::Mobile;

namespace {

// A throwaway data directory; the façade writes app config and logs into it.
struct ScopedDataDir
{
    boost::filesystem::path path;
    ScopedDataDir() : path(boost::filesystem::temp_directory_path() / boost::filesystem::unique_path("orca-mobile-%%%%-%%%%"))
    {
        boost::filesystem::create_directories(path);
    }
    ~ScopedDataDir() { boost::system::error_code ec; boost::filesystem::remove_all(path, ec); }
};

// Points the core at the shipped resources and a fresh data directory, once per process.
const ScopedDataDir& configured_directories()
{
    static ScopedDataDir dir;
    static bool          once = [] {
        set_directories(std::string(RESOURCES_DIR), dir.path.string());
        return true;
    }();
    (void) once;
    return dir;
}

const std::string& first_name_containing(const std::vector<PresetInfo>& presets, const std::string& needle)
{
    for (const PresetInfo& p : presets)
        if (p.is_system && p.name.find(needle) != std::string::npos)
            return p.name;
    FAIL("no system preset containing '" << needle << "'");
    static const std::string none;
    return none;
}

const std::string& first_compatible(const std::vector<PresetInfo>& presets)
{
    for (const PresetInfo& p : presets)
        if (p.is_system && p.is_compatible)
            return p.name;
    FAIL("no compatible system preset");
    static const std::string none;
    return none;
}

} // namespace

TEST_CASE("Mobile façade reports the core version", "[Session]")
{
    REQUIRE_FALSE(core_version().empty());
}

TEST_CASE("Option definitions describe every preset option", "[Session]")
{
    const nlohmann::json defs = nlohmann::json::parse(Session::option_definitions_json());
    REQUIRE(defs.is_array());
    REQUIRE(defs.size() > 100);

    bool found_layer_height = false, found_nozzle_diameter = false;
    for (const nlohmann::json& d : defs) {
        REQUIRE(d.contains("key"));
        REQUIRE(d.contains("kind"));
        REQUIRE(d.contains("type"));
        if (d["key"] == "layer_height") {
            found_layer_height = true;
            CHECK(d["kind"] == "process");
            CHECK(d["type"] == "float");
            CHECK(d["vector"] == false);
            CHECK(d.contains("default"));
        } else if (d["key"] == "nozzle_diameter") {
            found_nozzle_diameter = true;
            CHECK(d["kind"] == "printer");
            CHECK(d["vector"] == true);
        }
    }
    CHECK(found_layer_height);
    CHECK(found_nozzle_diameter);
}

TEST_CASE("Session loads presets, imports a model, slices and exports G-code", "[Session][slow]")
{
    const ScopedDataDir& dir = configured_directories();
    Session              session;

    SECTION("presets and options")
    {
        REQUIRE(session.load_presets().empty());

        const std::vector<PresetInfo> printers = session.presets(PresetKind::Printer);
        REQUIRE_FALSE(printers.empty());
        const std::string printer = first_name_containing(printers, "Voron 2.4 350 0.4 nozzle");
        REQUIRE(session.select_preset(PresetKind::Printer, printer));
        CHECK(session.selected_preset(PresetKind::Printer) == printer);

        const std::string filament = first_compatible(session.presets(PresetKind::Filament));
        REQUIRE(session.select_preset(PresetKind::Filament, filament));
        CHECK(session.selected_preset(PresetKind::Filament) == filament);

        const std::string process = first_compatible(session.presets(PresetKind::Process));
        REQUIRE(session.select_preset(PresetKind::Process, process));
        CHECK(session.selected_preset(PresetKind::Process) == process);

        const BedInfo bed = session.bed();
        CHECK(bed.shape.size() >= 4);
        CHECK(bed.height > 0);

        CHECK_FALSE(session.option("layer_height").empty());
        REQUIRE(session.set_option("layer_height", "0.3"));
        CHECK(session.option("layer_height") == "0.3");
        CHECK(session.modified_options(PresetKind::Process) == std::vector<std::string>{ "layer_height" });
        session.discard_modified_options(PresetKind::Process);
        CHECK(session.modified_options(PresetKind::Process).empty());
        CHECK_FALSE(session.set_option("no_such_option", "1"));
        CHECK_FALSE(session.set_option("layer_height", "not a number"));
    }

    SECTION("model, slice and export")
    {
        REQUIRE(session.load_presets().empty());
        REQUIRE(session.select_preset(PresetKind::Printer, first_name_containing(session.presets(PresetKind::Printer), "Voron 2.4 350 0.4 nozzle")));
        REQUIRE(session.select_preset(PresetKind::Filament, first_compatible(session.presets(PresetKind::Filament))));
        REQUIRE(session.select_preset(PresetKind::Process, first_compatible(session.presets(PresetKind::Process))));

        const std::vector<ObjectInfo> imported = session.import(std::string(TEST_DATA_DIR) + "/20mm_cube.obj");
        REQUIRE(imported.size() == 1);
        CHECK_THAT(imported.front().size[0], Catch::Matchers::WithinAbs(20.0, 0.01));
        CHECK(imported.front().triangles == 12);
        CHECK(session.objects().size() == 1);

        const BedInfo bed    = session.bed();
        const auto    center = imported.front().position;
        CHECK(center[0] > 0);
        CHECK(center[1] > 0);
        CHECK(center[0] < bed.shape[2][0]);

        const unsigned long id = imported.front().id;
        REQUIRE(session.set_transform(id, { center[0], center[1], 0 }, { 0, 0, 0 }, { 0.5, 0.5, 0.5 }));
        CHECK_THAT(session.objects().front().size[0], Catch::Matchers::WithinAbs(10.0, 0.01));
        session.arrange();
        CHECK(session.objects().size() == 1);

        int         last_percent = -1;
        SliceResult result       = session.slice([&last_percent](const Progress& p) { last_percent = p.percent; });
        INFO(result.error);
        REQUIRE(result.outcome == SliceOutcome::Finished);
        CHECK(session.is_sliced());
        CHECK(last_percent >= 0);

        const std::string gcode_path = (dir.path / "cube.gcode").string();
        const std::string written    = session.export_gcode(gcode_path);
        REQUIRE(boost::filesystem::exists(written));
        std::ifstream     in(written);
        const std::string gcode((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        CHECK(gcode.find("G1") != std::string::npos);

        const SliceStatistics stats = session.statistics();
        CHECK(stats.print_time_s > 0);
        CHECK(stats.filament_mm3 > 0);
        CHECK(stats.layer_count > 10);

        // Renderer input: the scaled cube as world-space triangles, and the toolpath.
        const MeshData mesh = session.mesh(id);
        REQUIRE(mesh.triangles == 12);
        REQUIRE(mesh.positions.size() == 12 * 9);
        REQUIRE(mesh.normals.size() == mesh.positions.size());
        float min_x = mesh.positions[0], max_x = mesh.positions[0];
        for (size_t i = 0; i < mesh.positions.size(); i += 3) {
            min_x = std::min(min_x, mesh.positions[i]);
            max_x = std::max(max_x, mesh.positions[i]);
        }
        CHECK_THAT(max_x - min_x, Catch::Matchers::WithinAbs(10.0, 0.01));
        CHECK(session.mesh(id + 1000000).triangles == 0);

        const PreviewData preview = session.preview();
        CHECK(preview.vertices.size() > 100);
        CHECK(preview.layer_zs.size() > 10);
        CHECK_THAT(preview.print_time_s, Catch::Matchers::WithinAbs(stats.print_time_s, 0.5));
        bool has_extrusion = false;
        for (const PreviewVertex& v : preview.vertices)
            has_extrusion |= v.type == PreviewMoveType::Extrude && v.role == PreviewRole::ExternalPerimeter && v.width > 0;
        CHECK(has_extrusion);

        CHECK(session.remove_object(id));
        CHECK(session.objects().empty());
        CHECK_FALSE(session.is_sliced());
        CHECK_THROWS(session.export_gcode(gcode_path));
    }
}
