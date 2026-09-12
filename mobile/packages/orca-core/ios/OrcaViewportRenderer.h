#import <Foundation/Foundation.h>
#import <MetalKit/MetalKit.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, OrcaViewportMode) {
  OrcaViewportModeScene = 0,
  OrcaViewportModePreview = 1,
};

/// Draws a session's bed, objects and toolpath into an MTKView. Reads geometry from the
/// native session by id (see SessionRegistry), never through JavaScript. Plain
/// Objective-C interface so the Swift Nitro View can use it; the C++ lives in the .mm.
@interface OrcaViewportRenderer : NSObject <MTKViewDelegate>

- (instancetype)initWithView:(MTKView *)view;

@property(nonatomic) uint64_t sessionId;
@property(nonatomic) OrcaViewportMode mode;
/// Highest layer id drawn in preview mode; negative draws every layer.
@property(nonatomic) NSInteger maxLayer;
@property(nonatomic) BOOL showTravels;

/// Re-reads bed, objects and toolpath from the session and redraws.
- (void)reload;
/// Frames the bed and everything on it.
- (void)fit;
/// Camera gestures, in points.
- (void)orbitBy:(CGPoint)delta;
- (void)panBy:(CGPoint)delta;
- (void)zoomBy:(CGFloat)factor;

@end

NS_ASSUME_NONNULL_END
