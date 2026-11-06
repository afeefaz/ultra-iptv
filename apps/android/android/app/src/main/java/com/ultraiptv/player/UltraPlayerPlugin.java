package com.ultraiptv.player;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Debug;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.Gravity;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;

import androidx.annotation.OptIn;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.text.CueGroup;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DecoderCounters;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.SubtitleView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;

/**
 * Media3 ExoPlayer for the web app (spec §4.2). The video view sits above the WebView for the
 * Live preview ("overlay") or under a transparent WebView in full screen ("behind"), so the
 * page's own controls stay on top. Never logs URLs: they carry the user's credentials.
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "UltraPlayer")
public class UltraPlayerPlugin extends Plugin {
    private static final String TAG = "UltraIPTV";
    private static final long PROGRESS_MS = 500;

    private ExoPlayer player;
    private FrameLayout container;
    private AspectRatioFrameLayout aspect;
    private SubtitleView subtitles;
    private String mode = "hidden";
    private boolean firstFrame;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            emitProgress();
            handler.postDelayed(this, PROGRESS_MS);
        }
    };

    @Override
    public void load() {
        getActivity().runOnUiThread(this::setupViews);
    }

    private void setupViews() {
        Context ctx = getContext();
        View webView = getBridge().getWebView();
        ViewGroup parent = (ViewGroup) webView.getParent();

        container = new FrameLayout(ctx);
        container.setBackgroundColor(Color.BLACK);
        container.setVisibility(View.GONE);
        aspect = new AspectRatioFrameLayout(ctx);
        aspect.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        TextureView texture = new TextureView(ctx);
        aspect.addView(texture, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        container.addView(aspect, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));
        subtitles = new SubtitleView(ctx);
        subtitles.setUserDefaultStyle();
        subtitles.setUserDefaultTextSize();
        container.addView(subtitles, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        parent.addView(container, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // The page paints its own background; it only becomes see-through for full-screen video.
        webView.setBackgroundColor(Color.TRANSPARENT);

        DefaultRenderersFactory renderers = new DefaultRenderersFactory(ctx)
            // Platform decoders first; FFmpeg (AC-3, E-AC-3, DTS…) when the device has none.
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
            .setEnableDecoderFallback(true);
        player = new ExoPlayer.Builder(ctx, renderers).build();
        player.setVideoTextureView(texture);
        player.addListener(new Listener());
    }

    // ---------- Playback ----------

    @PluginMethod
    public void load(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("url required");
            return;
        }
        String kind = call.getString("container", "progressive");
        boolean live = Boolean.TRUE.equals(call.getBoolean("live", false));
        Double startAt = call.getDouble("startAt");
        String buffer = call.getString("buffer", "balanced");
        String userAgent = call.getString("userAgent");
        String referrer = call.getString("referrer");
        getActivity().runOnUiThread(() -> {
            DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15_000)
                .setReadTimeoutMs(20_000);
            if (userAgent != null && !userAgent.isEmpty()) http.setUserAgent(userAgent);
            if (referrer != null && !referrer.isEmpty()) http.setDefaultRequestProperties(Collections.singletonMap("Referer", referrer));
            DefaultExtractorsFactory extractors = new DefaultExtractorsFactory()
                // IPTV TS streams often start mid-GOP or mark keyframes loosely.
                .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES
                    | DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS);
            MediaItem.Builder item = new MediaItem.Builder().setUri(Uri.parse(url));
            if ("hls".equals(kind)) item.setMimeType(MimeTypes.APPLICATION_M3U8);
            if (live) {
                long target = "low".equals(buffer) ? 3_000 : "stable".equals(buffer) ? 12_000 : 6_000;
                item.setLiveConfiguration(new MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(target).build());
            }
            MediaSource source = new DefaultMediaSourceFactory(http, extractors).createMediaSource(item.build());
            firstFrame = false;
            if ("overlay".equals(mode)) underPage();
            if (startAt != null && startAt > 0) player.setMediaSource(source, (long) (startAt * 1000));
            else player.setMediaSource(source);
            player.prepare();
            player.setPlayWhenReady(true);
            startTicking();
            Log.i(TAG, "load container=" + kind + " live=" + live);
            call.resolve();
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            player.play();
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            player.pause();
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            player.stop();
            player.clearMediaItems();
            firstFrame = false;
            handler.removeCallbacks(tick);
            subtitles.setCues(Collections.emptyList());
            if ("overlay".equals(mode)) underPage();
            keepScreenOn(false);
            call.resolve();
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        double seconds = call.getDouble("seconds", 0.0);
        getActivity().runOnUiThread(() -> {
            player.seekTo((long) (seconds * 1000));
            call.resolve();
        });
    }

    // ---------- Video surface ----------

    @PluginMethod
    public void setRect(PluginCall call) {
        String next = call.getString("mode", "hidden");
        double left = call.getDouble("left", 0.0);
        double top = call.getDouble("top", 0.0);
        double width = call.getDouble("width", 0.0);
        double height = call.getDouble("height", 0.0);
        getActivity().runOnUiThread(() -> {
            View webView = getBridge().getWebView();
            float density = webView.getResources().getDisplayMetrics().density;
            mode = next;
            // True black beside full-screen video (the strip at the camera cutout), so the
            // picture's black bars have no visible edge; the app's canvas colour otherwise.
            getActivity().getWindow().getDecorView().setBackgroundColor(
                "behind".equals(next) ? Color.BLACK : ContextCompat.getColor(getContext(), R.color.app_canvas));
            if ("hidden".equals(next)) {
                container.setVisibility(View.GONE);
            } else if ("behind".equals(next)) {
                underPage();
                ViewGroup.LayoutParams lp = container.getLayoutParams();
                lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
                lp.height = ViewGroup.LayoutParams.MATCH_PARENT;
                container.setLayoutParams(lp);
                container.setTranslationX(0);
                container.setTranslationY(0);
            } else {
                // At the preview box, on top of the page once a frame exists. Until then it stays
                // under the page (still drawn, so the video surface exists) and the page's
                // loading and error messages remain visible.
                container.setVisibility(View.VISIBLE);
                if (firstFrame) container.bringToFront();
                else underPage();
                ViewGroup.LayoutParams lp = container.getLayoutParams();
                lp.width = Math.round((float) width * density);
                lp.height = Math.round((float) height * density);
                container.setLayoutParams(lp);
                container.setTranslationX(webView.getX() + (float) left * density);
                container.setTranslationY(webView.getY() + (float) top * density);
            }
            call.resolve();
        });
    }

    /** Video under the WebView (page on top), but visible so its surface keeps existing. */
    private void underPage() {
        container.setVisibility(View.VISIBLE);
        getBridge().getWebView().bringToFront();
    }

    // ---------- Tracks ----------

    @PluginMethod
    public void selectAudio(PluginCall call) {
        String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            Tracks.Group group = groupFor(id, C.TRACK_TYPE_AUDIO);
            if (group != null) {
                player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                    .setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(), trackIndex(id)))
                    .build());
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void selectText(PluginCall call) {
        String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            if (id == null) {
                player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build());
            } else {
                Tracks.Group group = groupFor(id, C.TRACK_TYPE_TEXT);
                if (group != null) {
                    player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                        .setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(), trackIndex(id)))
                        .build());
                }
            }
            call.resolve();
        });
    }

    /** Track ids are "groupIndex:trackIndex" within `player.getCurrentTracks()`. */
    private Tracks.Group groupFor(String id, int type) {
        if (id == null || id.indexOf(':') < 0) return null;
        int g = Integer.parseInt(id.substring(0, id.indexOf(':')));
        java.util.List<Tracks.Group> groups = player.getCurrentTracks().getGroups();
        if (g < 0 || g >= groups.size() || groups.get(g).getType() != type) return null;
        return groups.get(g);
    }

    private static int trackIndex(String id) {
        return Integer.parseInt(id.substring(id.indexOf(':') + 1));
    }

    private void emitTracks(Tracks tracks) {
        JSArray audio = new JSArray();
        JSArray text = new JSArray();
        boolean textOn = !player.getTrackSelectionParameters().disabledTrackTypes.contains(C.TRACK_TYPE_TEXT);
        java.util.List<Tracks.Group> groups = tracks.getGroups();
        for (int g = 0; g < groups.size(); g++) {
            Tracks.Group group = groups.get(g);
            int type = group.getType();
            if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_TEXT) continue;
            for (int t = 0; t < group.length; t++) {
                if (!group.isTrackSupported(t)) continue;
                Format f = group.getTrackFormat(t);
                JSObject o = new JSObject();
                o.put("id", g + ":" + t);
                o.put("label", labelOf(f, type, (type == C.TRACK_TYPE_AUDIO ? audio : text).length() + 1));
                if (f.language != null && !"und".equals(f.language)) o.put("lang", f.language);
                o.put("selected", group.isTrackSelected(t) && (type == C.TRACK_TYPE_AUDIO || textOn));
                (type == C.TRACK_TYPE_AUDIO ? audio : text).put(o);
            }
        }
        JSObject e = new JSObject();
        e.put("audio", audio);
        e.put("text", text);
        notifyListeners("tracks", e);
    }

    private static String labelOf(Format f, int type, int n) {
        if (f.label != null && !f.label.isEmpty()) return f.label;
        if (f.language != null && !"und".equals(f.language)) {
            String name = new Locale(f.language).getDisplayLanguage(new Locale(f.language));
            if (!name.isEmpty()) return name.substring(0, 1).toUpperCase(Locale.ROOT) + name.substring(1);
        }
        return (type == C.TRACK_TYPE_AUDIO ? "Audio " : "Subtitles ") + n;
    }

    // ---------- Events ----------

    private class Listener implements Player.Listener {
        @Override
        public void onPlaybackStateChanged(int state) {
            if (state == Player.STATE_BUFFERING) emitState(firstFrame ? "buffering" : "loading");
            else if (state == Player.STATE_ENDED) emitState("ended");
            else if (state == Player.STATE_READY && !player.getPlayWhenReady()) emitState("paused");
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            keepScreenOn(isPlaying);
            if (isPlaying) {
                emitState("playing");
                // Audio-only streams never render a frame.
                if (!firstFrame && player.getVideoFormat() == null) onFirstFrame();
            } else if (player.getPlaybackState() == Player.STATE_READY) {
                emitState("paused");
            }
        }

        @Override
        public void onRenderedFirstFrame() {
            onFirstFrame();
        }

        @Override
        public void onVideoSizeChanged(VideoSize size) {
            if (size.width > 0 && size.height > 0) {
                aspect.setAspectRatio(size.height == 0 ? 1 : (size.width * size.pixelWidthHeightRatio) / size.height);
            }
        }

        @Override
        public void onCues(CueGroup cues) {
            subtitles.setCues(cues.cues);
        }

        @Override
        public void onTracksChanged(Tracks tracks) {
            emitTracks(tracks);
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                // Fell out of the live window (e.g. after a long pause): jump back to live.
                player.seekToDefaultPosition();
                player.prepare();
                return;
            }
            JSObject e = new JSObject();
            e.put("fatal", true);
            e.put("message", error.getErrorCodeName());
            Throwable cause = error.getCause();
            if (cause instanceof HttpDataSource.InvalidResponseCodeException) {
                e.put("httpStatus", ((HttpDataSource.InvalidResponseCodeException) cause).responseCode);
            }
            int code = error.errorCode;
            String kind;
            if (code >= 2000 && code < 3000) kind = "network";
            else if (code == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED
                || code == PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES
                || code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED) kind = "unsupported";
            else if (code >= 3000 && code < 5000) kind = "media";
            else kind = "unknown";
            e.put("kind", kind);
            Log.w(TAG, "playback error " + error.getErrorCodeName());
            emitState("error");
            notifyListeners("error", e);
        }
    }

    private void onFirstFrame() {
        if (firstFrame) return;
        firstFrame = true;
        Log.i(TAG, "first frame mode=" + mode);
        if ("overlay".equals(mode)) container.bringToFront();
        notifyListeners("firstFrame", new JSObject());
    }

    private void emitState(String state) {
        JSObject e = new JSObject();
        e.put("state", state);
        notifyListeners("state", e);
    }

    private void startTicking() {
        handler.removeCallbacks(tick);
        handler.postDelayed(tick, PROGRESS_MS);
    }

    private void emitProgress() {
        if (player == null) return;
        JSObject e = new JSObject();
        long duration = player.getDuration();
        boolean live = player.isCurrentMediaItemLive();
        e.put("current", Math.max(0, player.getCurrentPosition()) / 1000.0);
        e.put("duration", live || duration == C.TIME_UNSET ? 0 : duration / 1000.0);
        e.put("bufferSec", Math.round(Math.max(0, player.getBufferedPosition() - player.getCurrentPosition()) / 100.0) / 10.0);
        Format video = player.getVideoFormat();
        if (video != null) {
            e.put("width", video.width);
            e.put("height", video.height);
            if (video.bitrate > 0) e.put("bitrateKbps", video.bitrate / 1000);
        }
        DecoderCounters counters = player.getVideoDecoderCounters();
        if (counters != null) e.put("droppedFrames", counters.droppedBufferCount);
        notifyListeners("progress", e);
    }

    private void keepScreenOn(boolean on) {
        if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    // ---------- Other apps ----------

    /** "Open with…" another player (spec §4.2). */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "");
        if (url == null) {
            call.reject("url required");
            return;
        }
        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(Uri.parse(url), "video/*");
        view.putExtra("title", title);
        view.putExtra(Intent.EXTRA_TITLE, title);
        Intent chooser = Intent.createChooser(view, title);
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception ex) {
            call.reject("No player app found");
        }
    }

    /** Debug log export through the share sheet (spec §10). */
    @PluginMethod
    public void shareText(PluginCall call) {
        String filename = call.getString("filename", "ultraiptv-log.txt");
        String mimeType = call.getString("mimeType", "text/plain");
        String text = call.getString("text", "");
        try {
            File file = new File(getContext().getCacheDir(), filename);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mimeType);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, filename);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception ex) {
            call.reject("Could not share the file");
        }
    }

    // ---------- Lifecycle ----------

    @Override
    protected void handleOnPause() {
        if (player != null) player.pause();
    }

    @Override
    protected void handleOnDestroy() {
        handler.removeCallbacks(tick);
        if (player != null) {
            player.release();
            player = null;
        }
    }

    private volatile boolean downloadCancelled = false;

    @PluginMethod
    public void systemUsage(PluginCall call) {
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        ((ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(memory);
        JSObject result = new JSObject();
        result.put("ramTotal", memory.totalMem);
        result.put("ramUsed", memory.totalMem - memory.availMem);
        result.put("appUsed", Debug.getPss() * 1024);
        call.resolve(result);
    }

    /** Speed test: reads and discards, so providers without CORS headers and big files are fine. */
    @PluginMethod
    public void measureDownload(PluginCall call) {
        String url = call.getString("url");
        double seconds = call.getDouble("seconds", 0.0);
        if (url == null) {
            call.reject("No URL");
            return;
        }
        downloadCancelled = false;
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                long start = SystemClock.elapsedRealtime();
                // Followed by hand: HttpURLConnection won't cross between http and https.
                URL target = new URL(url);
                for (int hops = 0; ; hops++) {
                    connection = (HttpURLConnection) target.openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(15000);
                    connection.setRequestProperty("Accept-Encoding", "identity");
                    int code = connection.getResponseCode();
                    String location = connection.getHeaderField("Location");
                    if (code < 300 || code >= 400 || location == null || hops >= 5) break;
                    connection.disconnect();
                    target = new URL(target, location);
                }
                int status = connection.getResponseCode();
                long began = SystemClock.elapsedRealtime();
                long bytes = 0;
                if (status < 400 && seconds > 0) {
                    byte[] buffer = new byte[64 * 1024];
                    long lastReport = began;
                    try (InputStream in = connection.getInputStream()) {
                        int read;
                        while (!downloadCancelled && (read = in.read(buffer)) != -1) {
                            bytes += read;
                            long time = SystemClock.elapsedRealtime();
                            if (time - lastReport >= 200) {
                                lastReport = time;
                                JSObject progress = new JSObject();
                                progress.put("bytes", bytes);
                                progress.put("ms", time - began);
                                notifyListeners("downloadProgress", progress);
                            }
                            if (time - began >= seconds * 1000) break;
                        }
                    }
                }
                JSObject result = new JSObject();
                result.put("status", status);
                result.put("ttfbMs", began - start);
                result.put("bytes", bytes);
                result.put("ms", SystemClock.elapsedRealtime() - began);
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getClass().getSimpleName());
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        downloadCancelled = true;
        call.resolve();
    }
}
