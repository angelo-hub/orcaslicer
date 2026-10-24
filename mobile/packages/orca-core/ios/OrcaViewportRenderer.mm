#import "OrcaViewportRenderer.h"

#include "SessionRegistry.hpp"
#include "viewport/ViewportController.hpp"

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

#include <memory>
#include <vector>

// The Metal backend of the viewport: the platform-neutral part (scene building, toolpath
// segments and filtering, camera, picking, drag) lives in cpp/viewport/ and this file
// only uploads its vectors and draws them. The shader is compiled at runtime so the pod
// needs no metallib packaging.
static const char* const kShaderSource = R"metal(
#include <metal_stdlib>
using namespace metal;

struct VertexIn {
  packed_float3 position;
  packed_float4 color;
};

struct TexturedVertexIn {
  packed_float3 position;
  packed_float2 uv;
};

struct Uniforms {
  float4x4 mvp;
  float4 lightDir;
  float4 eye;         // xyz: camera position, which the mesh's derived normals face
  float4 color;       // flat colour of the mesh being drawn
  float4 modelOffset; // xyz added to every vertex; used to slide the dragged object each frame without a mesh rebuild
  float4 dragAnchor;  // xyz: world-space pivot the rotate/scale is performed around
  float4 dragParams;  // x: rotation-Z radians added at draw time, y: uniform scale multiplier, zw: padding
};

struct VertexOut {
  float4 position [[position]];
  float4 color;
};

// One toolpath move between two endpoints, with the bead's size for extrusions. One
// record per segment, so the layer slider only changes which range of the buffer is
// drawn, and the vertex shaders expand it to a line or a ribbon.
struct Segment {
  packed_float3 a;
  packed_float3 b;
  float width;
  float height;
  uchar4 color;
};

// A ribbon is the bead as a diamond in cross-section: corners top, right, bottom and
// left of the centre line, (side, up) in units of half the width and height.
constant float2 kRibbonCorners[4] = {float2(0, 1), float2(1, 0), float2(0, -1), float2(-1, 0)};
// Each of the four faces is two triangles between corner k and k + 1 of both ends:
// (end, corner step) per vertex.
constant uint2 kRibbonFaceVertices[6] = {uint2(0, 0), uint2(1, 0), uint2(1, 1), uint2(0, 0), uint2(1, 1), uint2(0, 1)};

struct TexturedOut {
  float4 position [[position]];
  float2 uv;
};

struct MeshOut {
  float4 position [[position]];
  float3 world;
};

vertex VertexOut orca_vertex(const device VertexIn* vertices [[buffer(0)]],
                             constant Uniforms& u [[buffer(1)]],
                             uint vid [[vertex_id]]) {
  VertexIn v = vertices[vid];
  VertexOut out;
  out.position = u.mvp * float4(float3(v.position), 1.0);
  out.color = float4(v.color);
  return out;
}

// Meshes are positions only: the colour is per draw and the face normal is derived in
// the fragment shader, a third of the memory of storing both per vertex.
vertex MeshOut orca_mesh_vertex(const device packed_float3* positions [[buffer(0)]],
                                constant Uniforms& u [[buffer(1)]],
                                uint vid [[vertex_id]]) {
  // Compose the per-draw model transform: rotate around the anchor by
  // dragParams.x radians (Z axis), then uniformly scale by dragParams.y from
  // the same anchor, then translate by modelOffset. For the non-dragged
  // meshes the caller passes anchor=(0,0,0), dragParams=(0,1) so this
  // collapses to identity + offset (offset is also zero for them).
  float3 rel = float3(positions[vid]) - u.dragAnchor.xyz;
  float c = cos(u.dragParams.x);
  float s = sin(u.dragParams.x);
  float3 rot;
  rot.x = c * rel.x - s * rel.y;
  rot.y = s * rel.x + c * rel.y;
  rot.z = rel.z;
  MeshOut out;
  out.world = rot * u.dragParams.y + u.dragAnchor.xyz + u.modelOffset.xyz;
  out.position = u.mvp * float4(out.world, 1.0);
  return out;
}

fragment float4 orca_mesh_fragment(MeshOut in [[stage_in]], constant Uniforms& u [[buffer(1)]]) {
  // The screen-space derivatives span the triangle, so their cross product is its flat
  // normal. Its sign depends on the screen's handedness; a visible face of a closed
  // mesh faces the camera, so turn it that way.
  float3 n = normalize(cross(dfdx(in.world), dfdy(in.world)));
  if (dot(n, u.eye.xyz - in.world) < 0) n = -n;
  const float shade = 0.35 + 0.65 * max(dot(n, normalize(u.lightDir.xyz)), 0.0);
  return float4(u.color.rgb * shade, u.color.a);
}

vertex VertexOut orca_segment_line_vertex(const device Segment* segments [[buffer(0)]],
                                          constant Uniforms& u [[buffer(1)]],
                                          uint vid [[vertex_id]],
                                          uint iid [[instance_id]]) {
  Segment s = segments[iid];
  VertexOut out;
  out.position = u.mvp * float4(vid == 0 ? float3(s.a) : float3(s.b), 1.0);
  out.color = float4(s.color) / 255.0;
  return out;
}

vertex VertexOut orca_ribbon_vertex(const device Segment* segments [[buffer(0)]],
                                    constant Uniforms& u [[buffer(1)]],
                                    uint vid [[vertex_id]],
                                    uint iid [[instance_id]]) {
  Segment s = segments[iid];
  const uint face = vid / 6;
  const uint2 pick = kRibbonFaceVertices[vid % 6];
  const float2 corner = kRibbonCorners[(face + pick.y) % 4];
  const float3 a = float3(s.a);
  const float3 b = float3(s.b);
  const float3 up = float3(0, 0, 1);
  // Beads lie flat; a vertical or zero-length move has no direction, so any side will do.
  const float3 side = cross(b - a, up);
  const float3 right = length_squared(side) > 1e-12 ? normalize(side) : float3(1, 0, 0);
  const float halfWidth = max(s.width, 0.05) * 0.5;
  const float halfHeight = max(s.height, 0.05) * 0.5;
  // G-code z is the top of the bead.
  const float3 centre = (pick.x == 0 ? a : b) - up * halfHeight;
  const float3 world = centre + right * (corner.x * halfWidth) + up * (corner.y * halfHeight);
  // Corner normals, interpolated across each face, shade the bead as if it were round.
  const float3 n = normalize(right * corner.x + up * corner.y);
  const float shade = 0.35 + 0.65 * max(dot(n, normalize(u.lightDir.xyz)), 0.0);
  VertexOut out;
  out.position = u.mvp * float4(world, 1.0);
  const float4 col = float4(s.color) / 255.0;
  out.color = float4(col.rgb * shade, col.a);
  return out;
}

fragment float4 orca_fragment(VertexOut in [[stage_in]]) {
  return in.color;
}

vertex TexturedOut orca_bed_vertex(const device TexturedVertexIn* vertices [[buffer(0)]],
                                    constant Uniforms& u [[buffer(1)]],
                                    uint vid [[vertex_id]]) {
  TexturedVertexIn v = vertices[vid];
  TexturedOut out;
  out.position = u.mvp * float4(float3(v.position) + u.modelOffset.xyz, 1.0);
  out.uv = float2(v.uv);
  return out;
}

fragment float4 orca_bed_fragment(TexturedOut in [[stage_in]],
                                   texture2d<float> tex [[texture(0)]],
                                   sampler samp [[sampler(0)]]) {
  return tex.sample(samp, in.uv);
}
)metal";

namespace {

using namespace orca::viewport;

// 4x MSAA, which every iOS GPU supports.
constexpr NSUInteger kSampleCount = 4;
constexpr MTLPixelFormat kDepthFormat = MTLPixelFormatDepth32Float;

// Uploads `items`, or returns nil for an empty list (Metal rejects zero-length buffers).
template <typename T> id<MTLBuffer> makeBuffer(id<MTLDevice> device, const std::vector<T>& items) {
  return items.empty() ? nil
                       : [device newBufferWithBytes:items.data() length:items.size() * sizeof(T) options:MTLResourceStorageModeShared];
}

Mode toMode(OrcaViewportMode mode) {
  return mode == OrcaViewportModePreview ? Mode::Preview : Mode::Scene;
}

OrcaViewportMode fromMode(Mode mode) {
  return mode == Mode::Preview ? OrcaViewportModePreview : OrcaViewportModeScene;
}

ColorMode toColorMode(OrcaPreviewColorMode mode) {
  switch (mode) {
    case OrcaPreviewColorModeSpeed: return ColorMode::Speed;
    case OrcaPreviewColorModeFlow: return ColorMode::Flow;
    case OrcaPreviewColorModeLayerTime: return ColorMode::LayerTime;
    case OrcaPreviewColorModeTool: return ColorMode::Tool;
    case OrcaPreviewColorModeFeature:
    default: return ColorMode::Feature;
  }
}

OrcaPreviewColorMode fromColorMode(ColorMode mode) {
  switch (mode) {
    case ColorMode::Speed: return OrcaPreviewColorModeSpeed;
    case ColorMode::Flow: return OrcaPreviewColorModeFlow;
    case ColorMode::LayerTime: return OrcaPreviewColorModeLayerTime;
    case ColorMode::Tool: return OrcaPreviewColorModeTool;
    case ColorMode::Feature:
    default: return OrcaPreviewColorModeFeature;
  }
}

ObjectTool toObjectTool(NSInteger tool) {
  return tool == 1 ? ObjectTool::Rotate : tool == 2 ? ObjectTool::Scale : ObjectTool::Move;
}

} // namespace

@interface OrcaViewportRenderer () <WKNavigationDelegate>
@end

@implementation OrcaViewportRenderer {
  __weak MTKView* _view;
  id<MTLDevice> _device;
  id<MTLCommandQueue> _queue;
  id<MTLRenderPipelineState> _pipeline;
  id<MTLRenderPipelineState> _meshPipeline;
  id<MTLRenderPipelineState> _segmentLinePipeline;
  id<MTLRenderPipelineState> _ribbonPipeline;
  id<MTLRenderPipelineState> _bedTexturePipeline;
  id<MTLDepthStencilState> _depthState;
  id<MTLSamplerState> _bedSampler;
  MTKTextureLoader* _textureLoader;
  // Multisampled colour and depth targets, resolved into the drawable. Memoryless on
  // a device, so they live in tile memory and cost no RAM, until a frame needs them
  // stored; see drawInMTKView:.
  id<MTLTexture> _msaaColor;
  id<MTLTexture> _msaaDepth;
  BOOL _msaaStored;

  std::unique_ptr<ViewportController> _controller;

  // GPU copies of the controller's geometry, refreshed when its revisions change.
  uint32_t _sceneRevision;
  uint32_t _toolpathRevision;
  id<MTLBuffer> _meshBuffer;
  id<MTLBuffer> _bedLineBuffer;
  id<MTLBuffer> _bedModelBuffer;
  id<MTLBuffer> _bedTextureQuadBuffer;
  id<MTLBuffer> _extrusionBuffer;
  id<MTLBuffer> _markerBuffer;
  id<MTLTexture> _bedTexture;
  NSString* _bedTextureLoadedPath;
  // Kept alive while the offscreen WKWebView renders an SVG bed art file.
  WKWebView* _svgRasterWebView;
}

- (instancetype)initWithView:(MTKView*)view {
  if ((self = [super init])) {
    _view = view;
    _device = MTLCreateSystemDefaultDevice();
    _queue = [_device newCommandQueue];
    __weak MTKView* weakView = view;
    _controller = std::make_unique<ViewportController>(
        [](uint64_t id, const std::function<void(Slic3r::Mobile::Session&)>& fn) {
          return margelo::nitro::orca::SessionRegistry::with(id, fn);
        },
        [weakView] { [weakView setNeedsDisplay]; });

    view.device = _device;
    // The renderer owns its multisampled depth target; see renderPassForDrawable:.
    view.depthStencilPixelFormat = MTLPixelFormatInvalid;
    view.clearColor = MTLClearColorMake(0.93, 0.94, 0.95, 1.0);
    view.enableSetNeedsDisplay = YES;
    view.paused = YES;
    view.delegate = self;

    NSError* error = nil;
    id<MTLLibrary> library = [_device newLibraryWithSource:[NSString stringWithUTF8String:kShaderSource] options:nil error:&error];
    if (library == nil) {
      NSLog(@"OrcaViewport: shader compile failed: %@", error);
      return self;
    }
    MTLRenderPipelineDescriptor* desc = [MTLRenderPipelineDescriptor new];
    desc.vertexFunction = [library newFunctionWithName:@"orca_vertex"];
    desc.fragmentFunction = [library newFunctionWithName:@"orca_fragment"];
    desc.colorAttachments[0].pixelFormat = view.colorPixelFormat;
    desc.depthAttachmentPixelFormat = kDepthFormat;
    desc.rasterSampleCount = kSampleCount;
    _pipeline = [_device newRenderPipelineStateWithDescriptor:desc error:&error];
    if (_pipeline == nil) {
      NSLog(@"OrcaViewport: pipeline failed: %@", error);
    }
    desc.vertexFunction = [library newFunctionWithName:@"orca_segment_line_vertex"];
    _segmentLinePipeline = [_device newRenderPipelineStateWithDescriptor:desc error:&error];
    if (_segmentLinePipeline == nil) {
      NSLog(@"OrcaViewport: segment pipeline failed: %@", error);
    }
    desc.vertexFunction = [library newFunctionWithName:@"orca_ribbon_vertex"];
    _ribbonPipeline = [_device newRenderPipelineStateWithDescriptor:desc error:&error];
    if (_ribbonPipeline == nil) {
      NSLog(@"OrcaViewport: ribbon pipeline failed: %@", error);
    }
    desc.vertexFunction = [library newFunctionWithName:@"orca_mesh_vertex"];
    desc.fragmentFunction = [library newFunctionWithName:@"orca_mesh_fragment"];
    _meshPipeline = [_device newRenderPipelineStateWithDescriptor:desc error:&error];
    if (_meshPipeline == nil) {
      NSLog(@"OrcaViewport: mesh pipeline failed: %@", error);
    }
    MTLRenderPipelineDescriptor* bedDesc = [MTLRenderPipelineDescriptor new];
    bedDesc.vertexFunction = [library newFunctionWithName:@"orca_bed_vertex"];
    bedDesc.fragmentFunction = [library newFunctionWithName:@"orca_bed_fragment"];
    bedDesc.colorAttachments[0].pixelFormat = view.colorPixelFormat;
    bedDesc.depthAttachmentPixelFormat = kDepthFormat;
    bedDesc.rasterSampleCount = kSampleCount;
    _bedTexturePipeline = [_device newRenderPipelineStateWithDescriptor:bedDesc error:&error];
    if (_bedTexturePipeline == nil) {
      NSLog(@"OrcaViewport: bed texture pipeline failed: %@", error);
    }
    MTLSamplerDescriptor* samp = [MTLSamplerDescriptor new];
    samp.minFilter = MTLSamplerMinMagFilterLinear;
    samp.magFilter = MTLSamplerMinMagFilterLinear;
    samp.mipFilter = MTLSamplerMipFilterLinear;
    samp.sAddressMode = MTLSamplerAddressModeClampToEdge;
    samp.tAddressMode = MTLSamplerAddressModeClampToEdge;
    _bedSampler = [_device newSamplerStateWithDescriptor:samp];
    _textureLoader = [[MTKTextureLoader alloc] initWithDevice:_device];
    MTLDepthStencilDescriptor* depth = [MTLDepthStencilDescriptor new];
    depth.depthCompareFunction = MTLCompareFunctionLessEqual;
    depth.depthWriteEnabled = YES;
    _depthState = [_device newDepthStencilStateWithDescriptor:depth];
  }
  return self;
}

// Touch coordinates and the drag mappings are in points; tell the controller the view's
// current size before anything that maps a point.
- (void)syncViewSize {
  MTKView* view = _view;
  if (view == nil) return;
  const CGSize size = view.bounds.size;
  _controller->setViewSize(float(size.width), float(size.height));
}

#pragma mark - Properties

- (void)setSessionId:(uint64_t)sessionId {
  _controller->setSessionId(sessionId);
}

- (uint64_t)sessionId {
  return _controller->sessionId();
}

- (void)setMode:(OrcaViewportMode)mode {
  _controller->setMode(toMode(mode));
}

- (OrcaViewportMode)mode {
  return fromMode(_controller->mode());
}

- (void)setMinLayer:(NSInteger)minLayer {
  _controller->setMinLayer(minLayer);
}

- (NSInteger)minLayer {
  return _controller->minLayer();
}

- (void)setMaxLayer:(NSInteger)maxLayer {
  _controller->setMaxLayer(maxLayer);
}

- (NSInteger)maxLayer {
  return _controller->maxLayer();
}

- (void)setMaxTime:(float)maxTime {
  _controller->setMaxTime(maxTime);
}

- (float)maxTime {
  return _controller->maxTime();
}

- (void)setShowTravels:(BOOL)showTravels {
  _controller->setShowTravels(showTravels);
}

- (BOOL)showTravels {
  return _controller->showTravels();
}

- (void)setShowRetractions:(BOOL)showRetractions {
  _controller->setShowRetractions(showRetractions);
}

- (BOOL)showRetractions {
  return _controller->showRetractions();
}

- (void)setShowWipes:(BOOL)showWipes {
  _controller->setShowWipes(showWipes);
}

- (BOOL)showWipes {
  return _controller->showWipes();
}

- (void)setColorMode:(OrcaPreviewColorMode)colorMode {
  _controller->setColorMode(toColorMode(colorMode));
}

- (OrcaPreviewColorMode)colorMode {
  return fromColorMode(_controller->colorMode());
}

- (void)setSelectedId:(uint64_t)selectedId {
  _controller->setSelectedId(selectedId);
}

- (uint64_t)selectedId {
  return _controller->selectedId();
}

#pragma mark - Geometry

- (void)reload {
  _controller->reload();
  [self syncBedTexture];
}

// Loads the bed texture the scene names, only when the path changed, so a slice does not
// thrash the texture. MTKTextureLoader handles PNG and JPG; SVG goes through WKWebView.
- (void)syncBedTexture {
  const std::string& path = _controller->scene().bedTexturePath;
  NSString* wantedPath = path.empty() ? nil : [NSString stringWithUTF8String:path.c_str()];
  if (wantedPath == nil) {
    _bedTexture = nil;
    _bedTextureLoadedPath = nil;
    return;
  }
  if ([wantedPath isEqualToString:_bedTextureLoadedPath]) return;
  _bedTextureLoadedPath = wantedPath;
  if ([wantedPath.pathExtension.lowercaseString isEqualToString:@"svg"]) {
    // The STL bed model draws immediately underneath, so the plate is never empty
    // while the snapshot is pending.
    _bedTexture = nil;
    [self loadSVGBedTexture:wantedPath];
  } else {
    NSURL* url = [NSURL fileURLWithPath:wantedPath];
    NSError* error = nil;
    _bedTexture = [_textureLoader newTextureWithContentsOfURL:url
                                                       options:@{ MTKTextureLoaderOptionSRGB : @NO,
                                                                  MTKTextureLoaderOptionOrigin : MTKTextureLoaderOriginBottomLeft }
                                                         error:&error];
    if (_bedTexture == nil) {
      NSLog(@"OrcaViewport: bed texture load failed for %@: %@", wantedPath, error);
    }
  }
}

// Re-uploads whatever the controller rebuilt since the last frame.
- (void)syncBuffers {
  if (_sceneRevision != _controller->sceneRevision()) {
    const SceneGeometry& scene = _controller->scene();
    _bedLineBuffer = makeBuffer(_device, scene.bedLines);
    _bedModelBuffer = makeBuffer(_device, scene.bedModel);
    _bedTextureQuadBuffer = makeBuffer(_device, scene.bedQuad);
    _meshBuffer = makeBuffer(_device, scene.mesh);
    _sceneRevision = _controller->sceneRevision();
  }
  if (_toolpathRevision != _controller->toolpathRevision()) {
    const Toolpath& toolpath = _controller->toolpath();
    _extrusionBuffer = makeBuffer(_device, toolpath.extrusions);
    _markerBuffer = makeBuffer(_device, toolpath.markers);
    _toolpathRevision = _controller->toolpathRevision();
  }
}

#pragma mark - Camera

- (void)fit {
  _controller->fit();
}

- (void)orbitBy:(CGPoint)delta {
  _controller->orbitBy(float(delta.x), float(delta.y));
}

- (void)panBy:(CGPoint)delta {
  _controller->panBy(float(delta.x), float(delta.y));
}

- (void)zoomBy:(CGFloat)factor {
  _controller->zoomBy(float(factor));
}

- (void)screenToRayFromX:(CGFloat)x
                       y:(CGFloat)y
               originOut:(vector_float3*)originOut
            directionOut:(vector_float3*)directionOut {
  if (originOut == NULL || directionOut == NULL) return;
  [self syncViewSize];
  float3 origin;
  float3 direction;
  if (!_controller->screenToRay(float(x), float(y), origin, direction)) return;
  *originOut = simd_make_float3(origin.x, origin.y, origin.z);
  *directionOut = simd_make_float3(direction.x, direction.y, direction.z);
}

- (BOOL)screenToPlateXYFromX:(CGFloat)x y:(CGFloat)y outX:(CGFloat*)outX outY:(CGFloat*)outY {
  if (outX == NULL || outY == NULL) return NO;
  [self syncViewSize];
  float plateX = 0, plateY = 0;
  if (!_controller->screenToPlateXY(float(x), float(y), plateX, plateY)) return NO;
  *outX = plateX;
  *outY = plateY;
  return YES;
}

- (uint64_t)pickObjectAtScreenX:(CGFloat)x y:(CGFloat)y {
  [self syncViewSize];
  return _controller->pickObject(float(x), float(y));
}

- (void)setObjectTool:(NSInteger)tool {
  _controller->setObjectTool(toObjectTool(tool));
}

- (BOOL)beginDragObject:(uint64_t)objectId atScreenX:(CGFloat)x y:(CGFloat)y {
  [self syncViewSize];
  return _controller->beginDrag(objectId, float(x), float(y));
}

- (void)dragToScreenX:(CGFloat)x y:(CGFloat)y {
  [self syncViewSize];
  _controller->dragTo(float(x), float(y));
}

- (void)endDrag {
  _controller->endDrag();
  [self syncBedTexture];
}

- (BOOL)isDragging {
  return _controller->isDragging();
}

#pragma mark - MTKViewDelegate

- (void)mtkView:(MTKView*)view drawableSizeWillChange:(CGSize)size {
  [self syncViewSize];
  [view setNeedsDisplay];
}

// Clears the multisampled targets and resolves them into the drawable. The targets are
// recreated when the drawable's size changes.
- (MTLRenderPassDescriptor*)renderPassForDrawable:(id<CAMetalDrawable>)drawable clearColor:(MTLClearColor)clearColor {
  id<MTLTexture> target = drawable.texture;
  if (_msaaColor == nil || _msaaColor.width != target.width || _msaaColor.height != target.height) {
    auto make = [&](MTLPixelFormat format) {
      MTLTextureDescriptor* desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:format
                                                                                      width:target.width
                                                                                     height:target.height
                                                                                  mipmapped:NO];
      desc.textureType = MTLTextureType2DMultisample;
      desc.sampleCount = kSampleCount;
      desc.usage = MTLTextureUsageRenderTarget;
#if TARGET_OS_SIMULATOR
      desc.storageMode = MTLStorageModePrivate;
#else
      desc.storageMode = _msaaStored ? MTLStorageModePrivate : MTLStorageModeMemoryless;
#endif
      return [_device newTextureWithDescriptor:desc];
    };
    _msaaColor = make(target.pixelFormat);
    _msaaDepth = make(kDepthFormat);
  }
  MTLRenderPassDescriptor* pass = [MTLRenderPassDescriptor renderPassDescriptor];
  pass.colorAttachments[0].texture = _msaaColor;
  pass.colorAttachments[0].resolveTexture = target;
  pass.colorAttachments[0].loadAction = MTLLoadActionClear;
  pass.colorAttachments[0].clearColor = clearColor;
  pass.colorAttachments[0].storeAction = MTLStoreActionMultisampleResolve;
  pass.depthAttachment.texture = _msaaDepth;
  pass.depthAttachment.loadAction = MTLLoadActionClear;
  pass.depthAttachment.clearDepth = 1.0;
  pass.depthAttachment.storeAction = MTLStoreActionDontCare;
  return pass;
}

- (void)drawInMTKView:(MTKView*)view {
  if (_pipeline == nil) {
    return;
  }
  id<CAMetalDrawable> drawable = view.currentDrawable;
  if (drawable == nil) {
    return;
  }
  [self syncBuffers];
  MTLRenderPassDescriptor* pass = [self renderPassForDrawable:drawable clearColor:view.clearColor];

  const CGSize drawableSize = view.drawableSize;
  Uniforms uniforms = _controller->frameUniforms(float(drawableSize.width), float(drawableSize.height));
  const ToolpathRanges& ranges = _controller->ranges();

  id<MTLCommandBuffer> commands = [_queue commandBuffer];
  id<MTLRenderCommandEncoder> encoder = [commands renderCommandEncoderWithDescriptor:pass];
  [encoder setDepthStencilState:_depthState];
  [encoder setCullMode:MTLCullModeNone];

  // Custom bed model (STL) first; it sits under everything.
  if (_bedModelBuffer != nil && _meshPipeline != nil) {
    const Uniforms bed = _controller->bedModelUniforms(uniforms);
    [encoder setRenderPipelineState:_meshPipeline];
    [encoder setVertexBuffer:_bedModelBuffer offset:0 atIndex:0];
    [encoder setVertexBytes:&bed length:sizeof(bed) atIndex:1];
    [encoder setFragmentBytes:&bed length:sizeof(bed) atIndex:1];
    [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:_controller->scene().bedModel.size()];
  }
  // Bed texture quad, on top of the STL or directly on the polygon.
  if (_bedTextureQuadBuffer != nil && _bedTexture != nil && _bedTexturePipeline != nil) {
    [encoder setRenderPipelineState:_bedTexturePipeline];
    [encoder setVertexBuffer:_bedTextureQuadBuffer offset:0 atIndex:0];
    [encoder setVertexBytes:&uniforms length:sizeof(uniforms) atIndex:1];
    [encoder setFragmentTexture:_bedTexture atIndex:0];
    [encoder setFragmentSamplerState:_bedSampler atIndex:0];
    [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:_controller->scene().bedQuad.size()];
  }

  [encoder setVertexBytes:&uniforms length:sizeof(uniforms) atIndex:1];
  // One instance per segment; the buffer offset selects the filtered range. Extrusions
  // are ribbons at the bead's width and height, the other moves thin lines.
  if (_ribbonPipeline != nil && _extrusionBuffer != nil && ranges.extrusions.count > 0) {
    [encoder setRenderPipelineState:_ribbonPipeline];
    [encoder setVertexBuffer:_extrusionBuffer offset:ranges.extrusions.first * sizeof(Segment) atIndex:0];
    [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:kRibbonVertexCount instanceCount:ranges.extrusions.count];
  }
  if (_segmentLinePipeline != nil && _markerBuffer != nil && ranges.markers.count > 0) {
    [encoder setRenderPipelineState:_segmentLinePipeline];
    [encoder setVertexBuffer:_markerBuffer offset:ranges.markers.first * sizeof(Segment) atIndex:0];
    [encoder drawPrimitives:MTLPrimitiveTypeLine vertexStart:0 vertexCount:2 instanceCount:ranges.markers.count];
  }
  [encoder setRenderPipelineState:_pipeline];
  if (_bedLineBuffer != nil) {
    [encoder setVertexBuffer:_bedLineBuffer offset:0 atIndex:0];
    [encoder drawPrimitives:MTLPrimitiveTypeLine vertexStart:0 vertexCount:_controller->scene().bedLines.size()];
  }
  if (_meshBuffer != nil && _meshPipeline != nil) {
    [encoder setRenderPipelineState:_meshPipeline];
    [encoder setVertexBuffer:_meshBuffer offset:0 atIndex:0];
    for (const MeshRange& range : _controller->scene().meshRanges) {
      const Uniforms mesh = _controller->meshUniforms(uniforms, range);
      [encoder setVertexBytes:&mesh length:sizeof(mesh) atIndex:1];
      [encoder setFragmentBytes:&mesh length:sizeof(mesh) atIndex:1];
      [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:range.start vertexCount:range.count];
    }
  }

  [encoder endEncoding];
  [commands presentDrawable:drawable];
  // A toolpath with millions of beads overflows the GPU's tiling memory, which then
  // renders the pass in parts and must store the targets in between. Memoryless
  // targets can't be stored, so the frame is dropped and the view stays black: from
  // then on, keep them in memory and draw again.
  __weak OrcaViewportRenderer* weakSelf = self;
  [commands addCompletedHandler:^(id<MTLCommandBuffer> buffer) {
    if (buffer.error == nil) return;
    NSLog(@"OrcaViewport: frame failed: %@", buffer.error);
    if (buffer.error.code != MTLCommandBufferErrorMemoryless) return;
    dispatch_async(dispatch_get_main_queue(), ^{
      OrcaViewportRenderer* strongSelf = weakSelf;
      if (strongSelf == nil || strongSelf->_msaaStored) return;
      strongSelf->_msaaStored = YES;
      strongSelf->_msaaColor = nil;
      [strongSelf->_view setNeedsDisplay];
    });
  }];
  [commands commit];
}

#pragma mark - SVG bed texture rasterization

- (void)loadSVGBedTexture:(NSString*)path {
  // Vendor bed textures (Qidi, Prusa, Voron, …) are .svg files that
  // MTKTextureLoader cannot decode. WKWebView loads SVG natively, so we
  // render the file into an offscreen 1024×1024 web view and hand the
  // resulting snapshot back to Metal as a texture. Must run on the main
  // thread — WKWebView is UIKit.
  const NSString* wanted = [path copy];
  dispatch_async(dispatch_get_main_queue(), ^{
    NSString* svg;
    NSError* readError = nil;
    svg = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:&readError];
    if (svg == nil || readError != nil) {
      NSLog(@"OrcaViewport: cannot read SVG bed texture %@: %@", path, readError);
      return;
    }
    NSString* html = [NSString stringWithFormat:
      @"<!doctype html><html><head><meta name=viewport content='width=1024'/><style>"
      @"html,body{margin:0;padding:0;background:transparent;width:1024px;height:1024px;overflow:hidden}"
      @"svg{width:100%%;height:100%%;display:block}"
      @"</style></head><body>%@</body></html>", svg];

    const CGRect frame = CGRectMake(0, 0, 1024, 1024);
    WKWebViewConfiguration* cfg = [[WKWebViewConfiguration alloc] init];
    self->_svgRasterWebView = [[WKWebView alloc] initWithFrame:frame configuration:cfg];
    self->_svgRasterWebView.opaque = NO;
    self->_svgRasterWebView.backgroundColor = [UIColor clearColor];
    self->_svgRasterWebView.scrollView.backgroundColor = [UIColor clearColor];
    self->_svgRasterWebView.navigationDelegate = self;
    // Track the path this render is for so a race between two loads keeps
    // the latest result.
    objc_setAssociatedObject(self->_svgRasterWebView, "orca.svg.path", wanted, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [self->_svgRasterWebView loadHTMLString:html baseURL:[NSURL fileURLWithPath:path.stringByDeletingLastPathComponent isDirectory:YES]];
  });
}

- (void)webView:(WKWebView*)webView didFinishNavigation:(WKNavigation*)navigation {
  // Wait one runloop so the layout / paint pass has landed before snapshotting.
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    WKSnapshotConfiguration* snap = [[WKSnapshotConfiguration alloc] init];
    snap.snapshotWidth = @1024;
    [webView takeSnapshotWithConfiguration:snap completionHandler:^(UIImage* image, NSError* error) {
      NSString* svgPath = objc_getAssociatedObject(webView, "orca.svg.path");
      if (image == nil) {
        NSLog(@"OrcaViewport: SVG snapshot failed for %@: %@", svgPath, error);
        if (self->_svgRasterWebView == webView) self->_svgRasterWebView = nil;
        return;
      }
      CGImageRef cg = image.CGImage;
      if (cg != NULL) {
        NSError* texError = nil;
        id<MTLTexture> tex = [self->_textureLoader newTextureWithCGImage:cg
                                                                  options:@{ MTKTextureLoaderOptionSRGB : @NO,
                                                                             MTKTextureLoaderOptionOrigin : MTKTextureLoaderOriginBottomLeft }
                                                                    error:&texError];
        if (tex != nil && [svgPath isEqualToString:self->_bedTextureLoadedPath]) {
          self->_bedTexture = tex;
          [self->_view setNeedsDisplay];
        } else if (tex == nil) {
          NSLog(@"OrcaViewport: MTL texture from SVG failed for %@: %@", svgPath, texError);
        }
      }
      if (self->_svgRasterWebView == webView) self->_svgRasterWebView = nil;
    }];
  });
}

@end
