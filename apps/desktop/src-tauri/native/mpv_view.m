// The video picture on macOS: a layer-backed view drawn by libmpv's render API (OpenGL), placed
// under the window's transparent web page. The page stays on top, so the app's own controls, focus
// rings and the Live preview frame draw over the video exactly as on Android (video-behind/hole).

#import <Cocoa/Cocoa.h>
#import <OpenGL/gl3.h>
#import <QuartzCore/QuartzCore.h>
#import <WebKit/WebKit.h>
#include <dlfcn.h>
#include <mpv/client.h>
#include <mpv/render_gl.h>

static void *ump_get_proc_address(void *ctx, const char *name) {
    (void)ctx;
    static void *lib = NULL;
    if (!lib) lib = dlopen("/System/Library/Frameworks/OpenGL.framework/OpenGL", RTLD_LAZY | RTLD_LOCAL);
    return lib ? dlsym(lib, name) : NULL;
}

@interface UMPGLLayer : CAOpenGLLayer
@property(nonatomic, assign) mpv_handle *mpv;
@property(nonatomic, assign) mpv_render_context *render;
@end

static void ump_on_update(void *ctx) {
    UMPGLLayer *layer = (__bridge UMPGLLayer *)ctx;
    dispatch_async(dispatch_get_main_queue(), ^{
      [layer setNeedsDisplay];
    });
}

@implementation UMPGLLayer

- (instancetype)initWithMpv:(mpv_handle *)mpv {
    if ((self = [super init])) {
        _mpv = mpv;
        self.asynchronous = NO;
        self.needsDisplayOnBoundsChange = YES;
        self.opaque = YES;
        self.backgroundColor = [NSColor blackColor].CGColor;
    }
    return self;
}

- (CGLPixelFormatObj)copyCGLPixelFormatForDisplayMask:(uint32_t)mask {
    (void)mask;
    CGLPixelFormatAttribute attrs[] = {
        kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
        kCGLPFADoubleBuffer, kCGLPFAAccelerated, kCGLPFAAllowOfflineRenderers, 0,
    };
    CGLPixelFormatObj pf = NULL;
    GLint count = 0;
    CGLChoosePixelFormat(attrs, &pf, &count);
    return pf;
}

- (CGLContextObj)copyCGLContextForPixelFormat:(CGLPixelFormatObj)pf {
    CGLContextObj ctx = [super copyCGLContextForPixelFormat:pf];
    CGLSetCurrentContext(ctx);
    if (!_render && _mpv) {
        mpv_opengl_init_params gl = {.get_proc_address = ump_get_proc_address, .get_proc_address_ctx = NULL};
        int advanced = 1;
        mpv_render_param params[] = {
            {MPV_RENDER_PARAM_API_TYPE, (void *)MPV_RENDER_API_TYPE_OPENGL},
            {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl},
            {MPV_RENDER_PARAM_ADVANCED_CONTROL, &advanced},
            {0, NULL},
        };
        mpv_render_context *render = NULL;
        if (mpv_render_context_create(&render, _mpv, params) >= 0) {
            _render = render;
            mpv_render_context_set_update_callback(render, ump_on_update, (__bridge void *)self);
        } else {
            NSLog(@"UltraIPTV: mpv render context could not be created");
        }
    }
    return ctx;
}

- (BOOL)canDrawInCGLContext:(CGLContextObj)ctx
                pixelFormat:(CGLPixelFormatObj)pf
               forLayerTime:(CFTimeInterval)t
                displayTime:(const CVTimeStamp *)ts {
    (void)ctx; (void)pf; (void)t; (void)ts;
    return YES;
}

- (void)drawInCGLContext:(CGLContextObj)ctx
             pixelFormat:(CGLPixelFormatObj)pf
            forLayerTime:(CFTimeInterval)t
             displayTime:(const CVTimeStamp *)ts {
    CGLSetCurrentContext(ctx);
    GLint fbo = 0;
    glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &fbo);
    // The layer's current size in pixels: GL_VIEWPORT can still hold the size before a resize.
    CGFloat scale = self.contentsScale > 0 ? self.contentsScale : 1;
    GLint viewport[4] = {0, 0, (GLint)lround(self.bounds.size.width * scale), (GLint)lround(self.bounds.size.height * scale)};
    glViewport(0, 0, viewport[2], viewport[3]);
    if (_render) {
        // Takes the frame mpv has ready; with advanced control this must be asked for each draw.
        uint64_t flags = mpv_render_context_update(_render);
        (void)flags;
        mpv_opengl_fbo target = {.fbo = fbo, .w = viewport[2], .h = viewport[3], .internal_format = 0};
        int flip = 1;
        mpv_render_param params[] = {
            {MPV_RENDER_PARAM_OPENGL_FBO, &target},
            {MPV_RENDER_PARAM_FLIP_Y, &flip},
            {0, NULL},
        };
        mpv_render_context_render(_render, params);
    } else {
        glClearColor(0, 0, 0, 1);
        glClear(GL_COLOR_BUFFER_BIT);
    }
    [super drawInCGLContext:ctx pixelFormat:pf forLayerTime:t displayTime:ts];
    if (_render) mpv_render_context_report_swap(_render);
}

- (void)releaseRender {
    if (_render) {
        mpv_render_context_set_update_callback(_render, NULL, NULL);
        mpv_render_context_free(_render);
        _render = NULL;
    }
}

@end

@interface UMPVideoView : NSView
@property(nonatomic, strong) UMPGLLayer *glLayer;
/** The page above it: rects come in its coordinates (CSS pixels from its top left). */
@property(nonatomic, weak) NSView *page;
@end

@implementation UMPVideoView

- (instancetype)initWithFrame:(NSRect)frame mpv:(mpv_handle *)mpv {
    if ((self = [super initWithFrame:frame])) {
        _glLayer = [[UMPGLLayer alloc] initWithMpv:mpv];
        self.wantsLayer = YES;
        self.layer = _glLayer;
        self.layerContentsRedrawPolicy = NSViewLayerContentsRedrawDuringViewResize;
    }
    return self;
}

- (BOOL)isFlipped {
    return YES;
}

// Clicks and keys go to the page above it, never to the video.
- (NSView *)hitTest:(NSPoint)point {
    (void)point;
    return nil;
}

- (void)viewDidChangeBackingProperties {
    [super viewDidChangeBackingProperties];
    self.layer.contentsScale = self.window ? self.window.backingScaleFactor : 2.0;
    [self.layer setNeedsDisplay];
}

@end

static WKWebView *ump_find_webview(NSView *view) {
    if ([view isKindOfClass:[WKWebView class]]) return (WKWebView *)view;
    for (NSView *child in view.subviews) {
        WKWebView *found = ump_find_webview(child);
        if (found) return found;
    }
    return nil;
}

/** Adds the video view to the window, under the web page. Must run on the main thread. */
void *ump_view_create(void *ns_window, void *mpv) {
    NSWindow *window = (__bridge NSWindow *)ns_window;
    NSView *content = window.contentView;
    WKWebView *web = ump_find_webview(content);
    NSView *host = content;
    if (web == content) {
        // The page is the window's content view itself: put both in a plain container.
        NSView *container = [[NSView alloc] initWithFrame:content.frame];
        container.autoresizesSubviews = YES;
        window.contentView = container;
        web.frame = container.bounds;
        web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        [container addSubview:web];
        host = container;
    }
    UMPVideoView *video = [[UMPVideoView alloc] initWithFrame:host.bounds mpv:(mpv_handle *)mpv];
    video.layer.contentsScale = window.backingScaleFactor;
    video.hidden = YES;
    video.page = web;
    NSView *above = web;
    while (above && above.superview != host) above = above.superview;
    [host addSubview:video positioned:NSWindowBelow relativeTo:above];
    // The window shows black where the page and video are both clear, never the desktop behind.
    window.backgroundColor = [NSColor blackColor];
    NSLog(@"UltraIPTV: video view added (content %@, webview %@)", NSStringFromClass(content.class),
          web ? NSStringFromClass(web.class) : @"none");
    return (__bridge_retained void *)video;
}

/** Places the video in CSS pixels from the top left of the page (1 CSS pixel = 1 point), or hides it. */
void ump_view_set_frame(void *view_ptr, double x, double y, double w, double h, int fill, int hidden) {
    UMPVideoView *video = (__bridge UMPVideoView *)view_ptr;
    NSView *host = video.superview;
    NSView *page = video.page ?: host;
    if (!host) return;
    // The page may not start at the window's top (title bar), so convert from its own coordinates.
    // The page's own frame runs under the title bar, but its content starts below it: CSS y = 0 is
    // the top of the window's content layout rect (0 extra in OS full screen, where the bar hides).
    NSWindow *window = video.window;
    CGFloat bar = window ? MAX(0, window.contentView.frame.size.height - window.contentLayoutRect.size.height) : 0;
    NSRect visible = NSMakeRect(0, page.isFlipped ? bar : 0, page.bounds.size.width, page.bounds.size.height - bar);
    NSRect inPage = fill ? visible : (page.isFlipped ? NSMakeRect(x, y + bar, w, h) : NSMakeRect(x, page.bounds.size.height - bar - y - h, w, h));
    video.frame = [host convertRect:inPage fromView:page];
    video.autoresizingMask = fill ? (NSViewWidthSizable | NSViewHeightSizable) : NSViewNotSizable;
    video.hidden = hidden ? YES : NO;
    [video.layer setNeedsDisplay];
}

/** Lets go of the GL renderer before mpv itself is destroyed. */
void ump_view_destroy(void *view_ptr) {
    UMPVideoView *video = (__bridge_transfer UMPVideoView *)view_ptr;
    [video.glLayer releaseRender];
    [video removeFromSuperview];
}


/** The window's number, its id for `screencapture -l` (debug builds' test hook only). */
long ump_window_number(void *ns_window) {
    NSWindow *window = (__bridge NSWindow *)ns_window;
    return (long)window.windowNumber;
}
