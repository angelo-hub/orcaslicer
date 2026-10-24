#pragma once

// Turns the façade's geometry into the vertex formats the backends draw: the bed, the
// objects' meshes, and the toolpath as segments coloured by the chosen mode and
// narrowed by the layer and time filters. Pure functions over value types, so they are
// testable on a desktop host without a session.

#include "ViewportTypes.hpp"

#include <OrcaCore/Session.hpp>

#include <string>
#include <vector>

namespace orca::viewport {

// What one reload reads from the session. In scene mode `mesh` holds every object's
// triangles and `preview` is empty; in preview mode the reverse.
struct SceneGeometry {
  std::vector<LineVertex> bedLines;
  // The printer's custom bed model, drawn as a slab under the plate outline; empty for a plain grid.
  std::vector<MeshVertex> bedModel;
  // The bed texture quad over the printable area's bounding rectangle, and the image it
  // shows; both empty when the preset has no texture.
  std::vector<TexturedVertex> bedQuad;
  std::string bedTexturePath;
  std::vector<MeshVertex> mesh;
  std::vector<MeshRange> meshRanges;
  Slic3r::Mobile::PreviewData preview;
  Bounds bounds;
};

// Bed outline, a 10 mm grid, the custom bed model and the texture quad.
void appendBed(const Slic3r::Mobile::BedInfo& bed, SceneGeometry& out);

// Reads the bed, and either the objects' meshes or the toolpath, from the session.
SceneGeometry buildScene(Slic3r::Mobile::Session& session, Mode mode);

struct ToolpathOptions {
  ColorMode colorMode = ColorMode::Feature;
  bool showTravels = false;
  bool showRetractions = false;
  bool showWipes = false;
};

// Toolpath segments in G-code order, extrusions and the other moves (travel, wipe,
// retraction ticks) apart, each with the index of the move it came from, which is what
// the layer and time filters select on.
struct Toolpath {
  std::vector<Segment> extrusions;
  std::vector<uint32_t> extrusionMoves;
  std::vector<Segment> markers;
  std::vector<uint32_t> markerMoves;
};

Toolpath buildToolpath(const Slic3r::Mobile::PreviewData& preview, const ToolpathOptions& options);

// Negative values draw everything.
struct ToolpathFilter {
  long minLayer = -1;
  long maxLayer = -1;
  float maxTime = -1.f;
};

struct ToolpathRanges {
  Range extrusions;
  Range markers;
};

// Narrows the drawn toolpath to the filter without touching the buffers. Moves come in
// G-code order, where layer ids and print time only grow, so each filter is a prefix or
// suffix of the moves and a binary search finds it.
ToolpathRanges filterToolpath(const Slic3r::Mobile::PreviewData& preview, const Toolpath& toolpath, const ToolpathFilter& filter);

// Colours shared by the backends.
extern const float kBedModelColor[4];
extern const float kObjectColor[4];
extern const float kSelectedObjectColor[4];

} // namespace orca::viewport
