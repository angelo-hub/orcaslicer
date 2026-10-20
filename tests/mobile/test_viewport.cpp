#include <catch2/catch_test_macros.hpp>
#include <catch2/generators/catch_generators.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "viewport/ViewportCamera.hpp"
#include "viewport/ViewportScene.hpp"

#include <cmath>

using namespace orca::viewport;
using Catch::Matchers::WithinAbs;
using Slic3r::Mobile::BedInfo;
using Slic3r::Mobile::PreviewData;
using Slic3r::Mobile::PreviewMoveType;
using Slic3r::Mobile::PreviewRole;
using Slic3r::Mobile::PreviewVertex;

namespace {

BedInfo square_bed(double side)
{
    BedInfo bed;
    bed.shape = {{0, 0}, {side, 0}, {side, side}, {0, side}};
    bed.height = 250;
    return bed;
}

PreviewVertex move(PreviewMoveType type, float x, float y, float z, unsigned layer, float time, float feedrate = 60.f)
{
    PreviewVertex v;
    v.position[0] = x;
    v.position[1] = y;
    v.position[2] = z;
    v.width       = 0.45f;
    v.height      = 0.2f;
    v.feedrate    = feedrate;
    v.volumetric_rate = feedrate * 0.09f;
    v.time        = time;
    v.layer_id    = layer;
    v.role        = PreviewRole::Perimeter;
    v.type        = type;
    return v;
}

// Three layers of two extrusions each, reached by a travel move; one retraction after
// layer 1. Times grow with the move index, so the time filter is a prefix like the layers.
// Move i's time is 10 * i, which the tests use to pick a cut-off.
PreviewData sample_preview()
{
    PreviewData preview;
    auto& v = preview.vertices;
    float t = 0;
    v.push_back(move(PreviewMoveType::Noop, 0, 0, 0.2f, 0, t));
    for (unsigned layer = 0; layer < 3; ++layer) {
        const float z = 0.2f * float(layer + 1);
        v.push_back(move(PreviewMoveType::Travel, 10, 10, z, layer, t += 10));
        v.push_back(move(PreviewMoveType::Extrude, 20, 10, z, layer, t += 10, 30.f + 30.f * float(layer)));
        v.push_back(move(PreviewMoveType::Extrude, 20, 20, z, layer, t += 10, 30.f + 30.f * float(layer)));
        if (layer == 1) {
            v.push_back(move(PreviewMoveType::Retract, 20, 20, z, layer, t += 10));
        }
    }
    preview.layer_zs    = {0.2f, 0.4f, 0.6f};
    preview.layer_times = {20.f, 30.f, 20.f};
    return preview;
}

std::size_t count_type(const PreviewData& preview, PreviewMoveType type)
{
    std::size_t n = 0;
    for (const auto& v : preview.vertices)
        if (v.type == type) ++n;
    return n;
}

} // namespace

TEST_CASE("The bed is drawn as its outline plus a 10 mm grid", "[Viewport]")
{
    SceneGeometry scene;
    appendBed(square_bed(100), scene);

    // Four outline edges and ten grid lines per axis (0, 10, ... 90), two vertices each.
    CHECK(scene.bedLines.size() == (4 + 10 + 10) * 2);
    CHECK(scene.bedModel.empty());
    CHECK(scene.bedQuad.empty());
    CHECK(scene.bedTexturePath.empty());
    REQUIRE(scene.bounds.valid);
    CHECK_THAT(scene.bounds.center().x, WithinAbs(50.f, 1e-4f));
    CHECK_THAT(scene.bounds.center().y, WithinAbs(50.f, 1e-4f));
    CHECK_THAT(scene.bounds.center().z, WithinAbs(0.f, 1e-4f));
}

TEST_CASE("A bed texture becomes a quad over the printable rectangle", "[Viewport]")
{
    BedInfo bed = square_bed(200);
    bed.custom_texture = "/printers/bed.svg";

    SceneGeometry scene;
    appendBed(bed, scene);

    CHECK(scene.bedTexturePath == "/printers/bed.svg");
    REQUIRE(scene.bedQuad.size() == 6);
    Bounds quad;
    for (const TexturedVertex& v : scene.bedQuad) {
        quad.add(make_float3(v.position[0], v.position[1], v.position[2]));
    }
    CHECK_THAT(quad.min.x, WithinAbs(0.f, 1e-6f));
    CHECK_THAT(quad.min.y, WithinAbs(0.f, 1e-6f));
    CHECK_THAT(quad.max.x, WithinAbs(200.f, 1e-6f));
    CHECK_THAT(quad.max.y, WithinAbs(200.f, 1e-6f));
    // Lifted a little above the plate so it never z-fights the grid.
    CHECK(quad.min.z > 0.f);
}

TEST_CASE("Every extrusion becomes one ribbon segment between consecutive moves", "[Viewport]")
{
    const PreviewData preview = sample_preview();
    const Toolpath toolpath = buildToolpath(preview, ToolpathOptions{});

    REQUIRE(toolpath.extrusions.size() == count_type(preview, PreviewMoveType::Extrude));
    CHECK(toolpath.extrusionMoves.size() == toolpath.extrusions.size());
    // The first extrusion runs from the travel's end point to its own.
    const Segment& first = toolpath.extrusions.front();
    CHECK_THAT(first.a[0], WithinAbs(10.f, 1e-6f));
    CHECK_THAT(first.b[0], WithinAbs(20.f, 1e-6f));
    CHECK_THAT(first.width, WithinAbs(0.45f, 1e-6f));
    CHECK_THAT(first.height, WithinAbs(0.2f, 1e-6f));
    // Travels, wipes and retractions are off by default.
    CHECK(toolpath.markers.empty());
}

TEST_CASE("Travel and retraction markers appear only when shown", "[Viewport]")
{
    const PreviewData preview = sample_preview();

    ToolpathOptions travels;
    travels.showTravels = true;
    CHECK(buildToolpath(preview, travels).markers.size() == count_type(preview, PreviewMoveType::Travel));

    ToolpathOptions retractions;
    retractions.showRetractions = true;
    const Toolpath ticks = buildToolpath(preview, retractions);
    REQUIRE(ticks.markers.size() == count_type(preview, PreviewMoveType::Retract));
    // A retraction is drawn as a short vertical tick at its position.
    CHECK_THAT(ticks.markers.front().b[2] - ticks.markers.front().a[2], WithinAbs(0.6f, 1e-6f));
}

TEST_CASE("The colour mode changes the segments' colours but not their count", "[Viewport]")
{
    const PreviewData preview = sample_preview();
    const ColorMode mode = GENERATE(ColorMode::Feature, ColorMode::Speed, ColorMode::Flow, ColorMode::LayerTime, ColorMode::Tool);

    ToolpathOptions options;
    options.colorMode = mode;
    const Toolpath toolpath = buildToolpath(preview, options);
    CHECK(toolpath.extrusions.size() == count_type(preview, PreviewMoveType::Extrude));
}

TEST_CASE("Speed colouring paints the fastest extrusion red", "[Viewport]")
{
    const PreviewData preview = sample_preview();
    ToolpathOptions options;
    options.colorMode = ColorMode::Speed;
    const Toolpath toolpath = buildToolpath(preview, options);

    // The last layer has the highest feedrate, the top of the blue → green → red gradient.
    const Segment& fastest = toolpath.extrusions.back();
    CHECK(fastest.color[0] == 255);
    CHECK(fastest.color[1] == 0);
    CHECK(fastest.color[2] == 0);
}

TEST_CASE("The layer filter selects a contiguous run of segments", "[Viewport]")
{
    const PreviewData preview = sample_preview();
    ToolpathOptions options;
    options.showTravels = true;
    const Toolpath toolpath = buildToolpath(preview, options);

    ToolpathRanges all = filterToolpath(preview, toolpath, ToolpathFilter{});
    CHECK(all.extrusions.first == 0);
    CHECK(all.extrusions.count == toolpath.extrusions.size());
    CHECK(all.markers.count == toolpath.markers.size());

    ToolpathFilter middle;
    middle.minLayer = 1;
    middle.maxLayer = 1;
    ToolpathRanges layer1 = filterToolpath(preview, toolpath, middle);
    CHECK(layer1.extrusions.first == 2);
    CHECK(layer1.extrusions.count == 2);
    CHECK(layer1.markers.first == 1);
    CHECK(layer1.markers.count == 1);

    ToolpathFilter bottom;
    bottom.maxLayer = 0;
    ToolpathRanges layer0 = filterToolpath(preview, toolpath, bottom);
    CHECK(layer0.extrusions.first == 0);
    CHECK(layer0.extrusions.count == 2);
}

TEST_CASE("The time filter stops at the last move printed by then", "[Viewport]")
{
    const PreviewData preview = sample_preview();
    const Toolpath toolpath = buildToolpath(preview, ToolpathOptions{});

    // Move 3 (the first layer's second extrusion) is printed at 30 s.
    ToolpathFilter filter;
    filter.maxTime = 30.f;
    ToolpathRanges ranges = filterToolpath(preview, toolpath, filter);
    CHECK(ranges.extrusions.first == 0);
    CHECK(ranges.extrusions.count == 2);

    filter.maxTime = 0.f;
    CHECK(filterToolpath(preview, toolpath, filter).extrusions.count == 0);
}

TEST_CASE("The ray through the view's centre points at the camera's target", "[Viewport]")
{
    Bounds bounds;
    bounds.add(make_float3(0, 0, 0));
    bounds.add(make_float3(100, 100, 50));
    OrbitCamera camera;
    camera.fit(bounds);

    float3 origin;
    float3 direction;
    REQUIRE(camera.screenToRay(200.f, 300.f, 400.f, 600.f, origin, direction));
    const float3 expected = normalize(camera.target() - camera.eye());
    CHECK_THAT(direction.x, WithinAbs(expected.x, 1e-3f));
    CHECK_THAT(direction.y, WithinAbs(expected.y, 1e-3f));
    CHECK_THAT(direction.z, WithinAbs(expected.z, 1e-3f));
    // The origin lies on the near plane, between the eye and the target.
    CHECK(length(origin - camera.eye()) < length(camera.target() - camera.eye()));
}

TEST_CASE("The view's centre projects onto the plate at the camera's target", "[Viewport]")
{
    Bounds bounds;
    bounds.add(make_float3(0, 0, 0));
    bounds.add(make_float3(200, 200, 0));
    OrbitCamera camera;
    camera.fit(bounds);

    float x = 0, y = 0;
    REQUIRE(camera.screenToPlateXY(150.f, 150.f, 300.f, 300.f, x, y));
    CHECK_THAT(x, WithinAbs(100.f, 0.1f));
    CHECK_THAT(y, WithinAbs(100.f, 0.1f));
    CHECK_FALSE(camera.screenToPlateXY(150.f, 150.f, 0.f, 0.f, x, y));
}

TEST_CASE("Zooming keeps the camera within its distance limits", "[Viewport]")
{
    OrbitCamera camera;
    camera.zoomBy(1e6f);
    CHECK(camera.distance() >= 5.f);
    camera.zoomBy(1e-6f);
    CHECK(camera.distance() <= 5000.f);
    const float before = camera.distance();
    camera.zoomBy(0.f);
    CHECK_THAT(camera.distance(), WithinAbs(before, 1e-6f));
}
