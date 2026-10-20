// Shared by every viewport shader. The block's layout is orca::viewport::Uniforms
// (cpp/viewport/ViewportTypes.hpp), uploaded byte for byte.
layout(set = 0, binding = 0) uniform Uniforms {
  mat4 mvp;
  vec4 lightDir;
  vec4 eye;         // xyz: camera position, which the mesh's derived normals face
  vec4 color;       // flat colour of the mesh being drawn
  vec4 modelOffset; // xyz added to every vertex; slides the dragged object each frame without a mesh rebuild
  vec4 dragAnchor;  // xyz: world-space pivot the rotate/scale is performed around
  vec4 dragParams;  // x: rotation-Z radians added at draw time, y: uniform scale multiplier
} u;

// The controller's matrices follow Metal's clip space, whose y points up; Vulkan's
// points down. The flip also reverses the winding, which is harmless with culling off.
vec4 clipPosition(vec3 world) {
  vec4 p = u.mvp * vec4(world, 1.0);
  p.y = -p.y;
  return p;
}

float shadeFor(vec3 n) {
  return 0.35 + 0.65 * max(dot(n, normalize(u.lightDir.xyz)), 0.0);
}
