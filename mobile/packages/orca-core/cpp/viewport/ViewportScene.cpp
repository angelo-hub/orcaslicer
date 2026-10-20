#include "ViewportScene.hpp"

#include <algorithm>
#include <cmath>

namespace orca::viewport {

using Slic3r::Mobile::PreviewData;
using Slic3r::Mobile::PreviewMoveType;
using Slic3r::Mobile::PreviewVertex;

// A translucent grey slab for the bed model; neutral sage for objects and amber for the
// selected one, mirroring the desktop's selection tint.
const float kBedModelColor[4] = {0.24f, 0.26f, 0.28f, 1.f};
const float kObjectColor[4] = {0.55f, 0.72f, 0.62f, 1.f};
const float kSelectedObjectColor[4] = {1.00f, 0.72f, 0.30f, 1.f};

namespace {

// Colours per PreviewRole, in enum order; the last entry is used for travel moves.
const float kRoleColors[][4] = {
    {0.50f, 0.50f, 0.50f, 1.f}, // None
    {1.00f, 0.90f, 0.30f, 1.f}, // Perimeter
    {1.00f, 0.49f, 0.22f, 1.f}, // ExternalPerimeter
    {0.12f, 0.12f, 1.00f, 1.f}, // OverhangPerimeter
    {0.69f, 0.19f, 0.16f, 1.f}, // InternalInfill
    {0.59f, 0.33f, 0.80f, 1.f}, // SolidInfill
    {0.94f, 0.25f, 0.25f, 1.f}, // TopSolidInfill
    {0.40f, 0.36f, 0.78f, 1.f}, // BottomSurface
    {1.00f, 0.55f, 0.41f, 1.f}, // Ironing
    {0.30f, 0.50f, 0.73f, 1.f}, // BridgeInfill
    {0.30f, 0.50f, 0.73f, 1.f}, // InternalBridgeInfill
    {1.00f, 1.00f, 1.00f, 1.f}, // GapFill
    {0.00f, 0.53f, 0.43f, 1.f}, // Skirt
    {0.00f, 0.53f, 0.43f, 1.f}, // Brim
    {0.00f, 1.00f, 0.00f, 1.f}, // Support
    {0.00f, 0.50f, 0.00f, 1.f}, // SupportInterface
    {0.35f, 0.60f, 0.30f, 1.f}, // SupportTransition
    {0.70f, 0.65f, 0.15f, 1.f}, // WipeTower
    {0.37f, 0.82f, 0.58f, 1.f}, // Custom
    {0.50f, 0.50f, 0.50f, 1.f}, // Mixed
    {0.10f, 0.60f, 1.00f, 1.f}, // Travel
};
constexpr std::size_t kTravelColor = sizeof(kRoleColors) / sizeof(kRoleColors[0]) - 1;
const float kWipeColor[4] = {0.90f, 0.70f, 0.10f, 1.f};
const float kRetractColor[4] = {0.95f, 0.20f, 0.20f, 1.f};

const float* roleColor(Slic3r::Mobile::PreviewRole role) {
  return kRoleColors[std::min(static_cast<std::size_t>(role), kTravelColor - 1)];
}

void pushLine(std::vector<LineVertex>& out, float x, float y, float z, const float* c) {
  out.push_back(LineVertex{{x, y, z}, {c[0], c[1], c[2], c[3]}});
}

// Appends the segment a→b and records the move it belongs to. Width and height are the
// bead's, zero for moves drawn as lines.
void pushSegment(std::vector<Segment>& out, std::vector<uint32_t>& moves, std::size_t move, const float* a, const float* b,
                 const float* c, float width = 0.f, float height = 0.f) {
  auto byte = [](float v) { return static_cast<uint8_t>(std::lround(std::clamp(v, 0.f, 1.f) * 255.f)); };
  out.push_back(Segment{{a[0], a[1], a[2]}, {b[0], b[1], b[2]}, width, height, {byte(c[0]), byte(c[1]), byte(c[2]), byte(c[3])}});
  moves.push_back(static_cast<uint32_t>(move));
}

// A three-stop gradient, blue → green → red, over [0, maxValue].
void colorForRate(float value, float maxValue, float out[4]) {
  const float t = maxValue > 0 ? std::clamp(value / maxValue, 0.f, 1.f) : 0.f;
  if (t < 0.5f) {
    const float k = t / 0.5f;
    out[0] = 0.f;
    out[1] = k;
    out[2] = 1.f - k;
  } else {
    const float k = (t - 0.5f) / 0.5f;
    out[0] = k;
    out[1] = 1.f - k;
    out[2] = 0.f;
  }
  out[3] = 1.f;
}

} // namespace

void appendBed(const Slic3r::Mobile::BedInfo& info, SceneGeometry& out) {
  const float grey[4] = {0.55f, 0.58f, 0.60f, 1.f};
  const float light[4] = {0.78f, 0.80f, 0.82f, 1.f};
  float minX = 1e30f, minY = 1e30f, maxX = -1e30f, maxY = -1e30f;
  if (info.shape.size() >= 2) {
    for (std::size_t i = 0; i < info.shape.size(); ++i) {
      const auto& a = info.shape[i];
      const auto& b = info.shape[(i + 1) % info.shape.size()];
      pushLine(out.bedLines, float(a[0]), float(a[1]), 0, grey);
      pushLine(out.bedLines, float(b[0]), float(b[1]), 0, grey);
      minX = std::min(minX, float(a[0]));
      maxX = std::max(maxX, float(a[0]));
      minY = std::min(minY, float(a[1]));
      maxY = std::max(maxY, float(a[1]));
    }
    for (float x = std::ceil(minX / 10.f) * 10.f; x < maxX; x += 10.f) {
      pushLine(out.bedLines, x, minY, 0, light);
      pushLine(out.bedLines, x, maxY, 0, light);
    }
    for (float y = std::ceil(minY / 10.f) * 10.f; y < maxY; y += 10.f) {
      pushLine(out.bedLines, minX, y, 0, light);
      pushLine(out.bedLines, maxX, y, 0, light);
    }
    out.bounds.add(make_float3(minX, minY, 0));
    out.bounds.add(make_float3(maxX, maxY, 0));
  }
  if (!info.model_mesh.positions.empty()) {
    const auto& mesh = info.model_mesh;
    out.bedModel.reserve(mesh.positions.size() / 3);
    for (std::size_t i = 0; i + 8 < mesh.positions.size(); i += 3) {
      out.bedModel.push_back({mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]});
    }
  }
  if (!info.custom_texture.empty() && info.shape.size() >= 2) {
    out.bedTexturePath = info.custom_texture;
    const float z = 0.02f; // a slight lift so it sits above the plate and z-fights nothing
    auto pushTex = [&](float x, float y, float u, float v) { out.bedQuad.push_back(TexturedVertex{{x, y, z}, {u, v}}); };
    // Two triangles, counter-clockwise seen from +Z.
    pushTex(minX, minY, 0.f, 1.f);
    pushTex(maxX, minY, 1.f, 1.f);
    pushTex(maxX, maxY, 1.f, 0.f);
    pushTex(minX, minY, 0.f, 1.f);
    pushTex(maxX, maxY, 1.f, 0.f);
    pushTex(minX, maxY, 0.f, 0.f);
  }
}

SceneGeometry buildScene(Slic3r::Mobile::Session& session, Mode mode) {
  SceneGeometry out;
  appendBed(session.bed(), out);
  if (mode == Mode::Preview) {
    out.preview = session.preview();
    for (const auto& v : out.preview.vertices) {
      if (v.type == PreviewMoveType::Extrude) {
        out.bounds.add(make_float3(v.position[0], v.position[1], v.position[2]));
      }
    }
  } else {
    for (const Slic3r::Mobile::ObjectInfo& object : session.objects()) {
      const Slic3r::Mobile::MeshData mesh = session.mesh(object.id);
      const std::size_t before = out.mesh.size();
      out.mesh.reserve(before + mesh.triangles * 3);
      for (std::size_t i = 0; i + 2 < mesh.positions.size(); i += 3) {
        out.mesh.push_back({mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]});
        out.bounds.add(make_float3(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]));
      }
      out.meshRanges.push_back(MeshRange{static_cast<uint64_t>(object.id), before, out.mesh.size() - before});
    }
  }
  return out;
}

Toolpath buildToolpath(const PreviewData& preview, const ToolpathOptions& options) {
  Toolpath out;
  if (preview.vertices.size() < 2) return out;
  out.extrusions.reserve(preview.vertices.size());
  out.extrusionMoves.reserve(preview.vertices.size());
  // The gradient spans the print's own maximum so it reads the same however fast,
  // thick or slow the print is.
  float maxFeedrate = 0.f;
  float maxVolumetric = 0.f;
  float maxLayerTime = 0.f;
  if (options.colorMode == ColorMode::Speed || options.colorMode == ColorMode::Flow) {
    for (const auto& v : preview.vertices) {
      if (v.type != PreviewMoveType::Extrude) continue;
      maxFeedrate = std::max(maxFeedrate, v.feedrate);
      maxVolumetric = std::max(maxVolumetric, v.volumetric_rate);
    }
  } else if (options.colorMode == ColorMode::LayerTime) {
    for (float t : preview.layer_times) maxLayerTime = std::max(maxLayerTime, t);
  }
  for (std::size_t i = 1; i < preview.vertices.size(); ++i) {
    const PreviewVertex& a = preview.vertices[i - 1];
    const PreviewVertex& b = preview.vertices[i];
    if (b.type == PreviewMoveType::Extrude) {
      float dynamic[4];
      const float* color = nullptr;
      switch (options.colorMode) {
        case ColorMode::Speed:
          colorForRate(b.feedrate, maxFeedrate, dynamic);
          color = dynamic;
          break;
        case ColorMode::Flow:
          colorForRate(b.volumetric_rate, maxVolumetric, dynamic);
          color = dynamic;
          break;
        case ColorMode::Tool: {
          const std::size_t idx = b.extruder_id;
          if (idx < preview.tool_colors.size()) {
            const auto& c = preview.tool_colors[idx];
            dynamic[0] = c[0];
            dynamic[1] = c[1];
            dynamic[2] = c[2];
            dynamic[3] = c[3];
            color = dynamic;
          } else {
            color = roleColor(b.role);
          }
          break;
        }
        case ColorMode::LayerTime: {
          const float t = b.layer_id < preview.layer_times.size() ? preview.layer_times[b.layer_id] : 0.f;
          colorForRate(t, maxLayerTime, dynamic);
          color = dynamic;
          break;
        }
        case ColorMode::Feature:
        default:
          color = roleColor(b.role);
          break;
      }
      pushSegment(out.extrusions, out.extrusionMoves, i, a.position, b.position, color, b.width, b.height);
    } else if (options.showTravels && b.type == PreviewMoveType::Travel) {
      pushSegment(out.markers, out.markerMoves, i, a.position, b.position, kRoleColors[kTravelColor]);
    } else if (options.showWipes && b.type == PreviewMoveType::Wipe) {
      pushSegment(out.markers, out.markerMoves, i, a.position, b.position, kWipeColor);
    } else if (options.showRetractions && (b.type == PreviewMoveType::Retract || b.type == PreviewMoveType::Unretract)) {
      // A short vertical tick at the position stands in for the marker.
      const float top[3] = {b.position[0], b.position[1], b.position[2] + 0.6f};
      pushSegment(out.markers, out.markerMoves, i, b.position, top, kRetractColor);
    }
  }
  return out;
}

ToolpathRanges filterToolpath(const PreviewData& preview, const Toolpath& toolpath, const ToolpathFilter& filter) {
  const auto& moves = preview.vertices;
  std::size_t lo = 0;
  std::size_t hi = moves.size();
  if (filter.minLayer >= 0) {
    const unsigned int minLayer = static_cast<unsigned int>(filter.minLayer);
    lo = std::partition_point(moves.begin(), moves.end(), [&](const PreviewVertex& v) { return v.layer_id < minLayer; }) - moves.begin();
  }
  if (filter.maxLayer >= 0) {
    const unsigned int maxLayer = static_cast<unsigned int>(filter.maxLayer);
    hi = std::partition_point(moves.begin(), moves.end(), [&](const PreviewVertex& v) { return v.layer_id <= maxLayer; }) - moves.begin();
  }
  if (filter.maxTime >= 0.f) {
    const float maxTime = filter.maxTime;
    hi = std::min<std::size_t>(hi, std::partition_point(moves.begin(), moves.end(), [&](const PreviewVertex& v) { return v.time <= maxTime; }) - moves.begin());
  }
  auto range = [&](const std::vector<uint32_t>& segmentMoves) {
    const std::size_t first = std::lower_bound(segmentMoves.begin(), segmentMoves.end(), lo) - segmentMoves.begin();
    const std::size_t last = std::lower_bound(segmentMoves.begin(), segmentMoves.end(), std::max(lo, hi)) - segmentMoves.begin();
    return Range{first, last - first};
  };
  return ToolpathRanges{range(toolpath.extrusionMoves), range(toolpath.markerMoves)};
}

} // namespace orca::viewport
