#pragma once

// The vertex formats and the per-draw uniforms the viewport's platform backends upload.
// Each struct's layout is what the shaders read, so a backend copies the controller's
// vectors into GPU buffers byte for byte.

#include "ViewportMath.hpp"

#include <array>
#include <cstddef>
#include <cstdint>

namespace orca::viewport {

enum class Mode { Scene, Preview };
enum class ColorMode { Feature, Speed, Flow, LayerTime, Tool };
enum class ObjectTool { Move, Rotate, Scale };

// Bed outline and grid lines.
struct LineVertex {
  float position[3];
  float color[4];
};

// Meshes are positions only: the colour is per draw and the face normal is derived in
// the fragment shader, a third of the memory of storing both per vertex.
using MeshVertex = std::array<float, 3>;

// One object's triangles within the mesh buffer, drawn with their own colour and, while
// the object is dragged, the drag transform.
struct MeshRange {
  uint64_t id;
  std::size_t start;
  std::size_t count;
};

struct TexturedVertex {
  float position[3];
  float uv[2];
};

// One toolpath move between two endpoints, with the bead's size for extrusions. One
// record per segment, so the layer slider only changes which range of the buffer is
// drawn, and the vertex shaders expand it to a line or a ribbon. 36 bytes, 4-byte
// aligned, so any segment's offset is a valid vertex buffer offset.
struct Segment {
  float a[3];
  float b[3];
  float width;
  float height;
  uint8_t color[4];
};
static_assert(sizeof(Segment) == 36, "Segment must match the shaders' layout");

// Vertices the ribbon shader expands one segment into: four faces of two triangles.
constexpr std::size_t kRibbonVertexCount = 24;

// A contiguous run of a buffer, in elements.
struct Range {
  std::size_t first = 0;
  std::size_t count = 0;
};

struct Uniforms {
  float4x4 mvp;
  float4 lightDir;
  float4 eye;         // xyz: camera position, which the mesh's derived normals face
  float4 color;       // flat colour of the mesh being drawn
  float4 modelOffset; // xyz added to every vertex; slides the dragged object each frame without a mesh rebuild
  float4 dragAnchor;  // xyz: world-space pivot the rotate/scale is performed around
  float4 dragParams;  // x: rotation-Z radians added at draw time, y: uniform scale multiplier, zw: padding
};
static_assert(sizeof(Uniforms) == 160, "Uniforms must match the shaders' layout");

struct Bounds {
  float3 min{1e30f, 1e30f, 1e30f};
  float3 max{-1e30f, -1e30f, -1e30f};
  bool valid = false;
  void add(float3 p) {
    min = vmin(min, p);
    max = vmax(max, p);
    valid = true;
  }
  float3 center() const { return (min + max) * 0.5f; }
  float radius() const { return valid ? length(max - min) * 0.5f : 100.f; }
};

} // namespace orca::viewport
