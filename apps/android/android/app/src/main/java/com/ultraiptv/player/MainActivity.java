package com.ultraiptv.player;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Keyboard, camera cutout and navigation bar space are handled by Capacitor's SystemBars plugin,
 * which pads the window's root view (and paints it with the theme's windowBackground, so that
 * must stay a colour). Don't pad or resize views for them here: doing it twice leaves a
 * zero-height page for a frame, which closes the keyboard.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UltraPlayerPlugin.class);
        super.onCreate(savedInstanceState);
        if (BuildConfig.PERF_BUILD) WebView.setWebContentsDebuggingEnabled(true);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    /** Full screen on phones (landscape video app); a swipe brings the bars back briefly. */
    private void hideSystemBars() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
