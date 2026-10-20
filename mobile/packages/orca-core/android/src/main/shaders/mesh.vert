#version 450
#extension GL_GOOGLE_include_directive : require
#include "common.glsl"

// Meshes are positions only: the colour is per draw and the face normal is derived in
// the fragment shader.
layout(location = 0) in vec3 inPosition;
layout(location = 0) out vec3 outWorld;

void main() {
  // Rotate around the anchor by dragParams.x radians (Z axis), scale uniformly by
  // dragParams.y from the same anchor, then translate by modelOffset. Meshes that are
  // not being dragged get anchor 0, params (0, 1) and offset 0: the identity.
  const vec3 rel = inPosition - u.dragAnchor.xyz;
  const float c = cos(u.dragParams.x);
  const float s = sin(u.dragParams.x);
  const vec3 rot = vec3(c * rel.x - s * rel.y, s * rel.x + c * rel.y, rel.z);
  outWorld = rot * u.dragParams.y + u.dragAnchor.xyz + u.modelOffset.xyz;
  gl_Position = clipPosition(outWorld);
}
