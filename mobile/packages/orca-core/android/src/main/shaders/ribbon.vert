#version 450
#extension GL_GOOGLE_include_directive : require
#include "common.glsl"

// One instance per extrusion segment, expanded into the bead: a diamond in cross-section
// with corners top, right, bottom and left of the centre line, (side, up) in units of
// half the width and height.
layout(location = 0) in vec3 inA;
layout(location = 1) in vec3 inB;
layout(location = 2) in float inWidth;
layout(location = 3) in float inHeight;
layout(location = 4) in vec4 inColor;
layout(location = 0) out vec4 outColor;

const vec2 kRibbonCorners[4] = vec2[4](vec2(0, 1), vec2(1, 0), vec2(0, -1), vec2(-1, 0));
// Each of the four faces is two triangles between corner k and k + 1 of both ends:
// (end, corner step) per vertex.
const uvec2 kRibbonFaceVertices[6] = uvec2[6](uvec2(0, 0), uvec2(1, 0), uvec2(1, 1), uvec2(0, 0), uvec2(1, 1), uvec2(0, 1));

void main() {
  const uint vid = uint(gl_VertexIndex);
  const uint face = vid / 6u;
  const uvec2 pick = kRibbonFaceVertices[vid % 6u];
  const vec2 corner = kRibbonCorners[(face + pick.y) % 4u];
  const vec3 up = vec3(0, 0, 1);
  // Beads lie flat; a vertical or zero-length move has no direction, so any side will do.
  const vec3 side = cross(inB - inA, up);
  const vec3 right = dot(side, side) > 1e-12 ? normalize(side) : vec3(1, 0, 0);
  const float halfWidth = max(inWidth, 0.05) * 0.5;
  const float halfHeight = max(inHeight, 0.05) * 0.5;
  // G-code z is the top of the bead.
  const vec3 centre = (pick.x == 0u ? inA : inB) - up * halfHeight;
  const vec3 world = centre + right * (corner.x * halfWidth) + up * (corner.y * halfHeight);
  // Corner normals, interpolated across each face, shade the bead as if it were round.
  const vec3 n = normalize(right * corner.x + up * corner.y);
  gl_Position = clipPosition(world);
  outColor = vec4(inColor.rgb * shadeFor(n), inColor.a);
}
