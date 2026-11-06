package com.ultraiptv.player;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Updates the app from inside the app (docs/sideloading.md). Downloads only from our releases and
 * checks the file's hash. Android then refuses anything not signed with the app's own key.
 */
@CapacitorPlugin(name = "UltraUpdater")
public class UltraUpdaterPlugin extends Plugin {
    private static final String TAG = "UltraIPTV";
    private static final String ALLOWED_PREFIX = "https://github.com/afeefaz/ultra-iptv/releases/download/";
    private static final String STATUS_ACTION = ".UPDATE_STATUS";
    private static final int TIMEOUT_MS = 30_000;

    private volatile boolean running;
    private BroadcastReceiver statusReceiver;

    @Override
    public void load() {
        statusReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                onStatus(intent);
            }
        };
        IntentFilter filter = new IntentFilter(getContext().getPackageName() + STATUS_ACTION);
        ContextCompat.registerReceiver(getContext(), statusReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        if (statusReceiver != null) getContext().unregisterReceiver(statusReceiver);
    }

    @PluginMethod
    public void info(PluginCall call) {
        Context context = getContext();
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            result.put("canInstall", Build.VERSION.SDK_INT < 26 || context.getPackageManager().canRequestPackageInstalls());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Couldn't read the app's version");
        }
    }

    /** Android's "install unknown apps" switch for this app. Not every TV has the screen. */
    @PluginMethod
    public void openInstallPermission(PluginCall call) {
        JSObject result = new JSObject();
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
            result.put("opened", true);
        } catch (Exception e) {
            result.put("opened", false);
        }
        call.resolve(result);
    }

    /** Resolves once the system has the update; "status" events say what happens after that. */
    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url", "");
        String sha256 = call.getString("sha256", "");
        if (!url.startsWith(ALLOWED_PREFIX) || sha256.isEmpty()) {
            call.reject("Not one of our releases", "invalid");
            return;
        }
        if (running) {
            call.reject("Already updating", "busy");
            return;
        }
        running = true;
        new Thread(() -> {
            File file = new File(getContext().getCacheDir(), "update.apk");
            try {
                String actual = download(url, file);
                if (!actual.equalsIgnoreCase(sha256)) {
                    call.reject("The download doesn't match", "corrupt");
                    return;
                }
                commit(file);
                call.resolve();
            } catch (IOException e) {
                Log.w(TAG, "update download failed: " + e.getClass().getSimpleName());
                call.reject("Couldn't download the update", "network");
            } catch (Exception e) {
                Log.w(TAG, "update failed: " + e.getClass().getSimpleName());
                call.reject("Couldn't start the update", "install");
            } finally {
                file.delete();
                running = false;
            }
        }).start();
    }

    private String download(String url, File file) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(TIMEOUT_MS);
        connection.setReadTimeout(TIMEOUT_MS);
        try {
            if (connection.getResponseCode() != 200) throw new IOException("status " + connection.getResponseCode());
            long total = connection.getContentLength();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long read = 0;
            int lastPercent = -1;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(file)) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) >= 0) {
                    out.write(buffer, 0, n);
                    digest.update(buffer, 0, n);
                    read += n;
                    int percent = total > 0 ? (int) (read * 100 / total) : 0;
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        JSObject progress = new JSObject();
                        progress.put("percent", percent);
                        notifyListeners("progress", progress);
                    }
                }
            }
            StringBuilder hex = new StringBuilder();
            for (byte b : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", b));
            return hex.toString();
        } finally {
            connection.disconnect();
        }
    }

    private void commit(File file) throws IOException {
        Context context = getContext();
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(context.getPackageName());
        params.setSize(file.length());
        // Android 12 and newer may skip the confirmation for an app updating itself. Older ones ask.
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(file); OutputStream out = session.openWrite("base.apk", 0, file.length())) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) >= 0) out.write(buffer, 0, n);
                session.fsync(out);
            }
            Intent status = new Intent(context.getPackageName() + STATUS_ACTION).setPackage(context.getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            session.commit(PendingIntent.getBroadcast(context, id, status, flags).getIntentSender());
        } catch (IOException | RuntimeException e) {
            installer.abandonSession(id);
            throw e;
        }
    }

    private void onStatus(Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        JSObject event = new JSObject();
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) getContext().startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            event.put("state", "confirm");
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            event.put("state", "installed");
        } else {
            Log.w(TAG, "update refused, status " + status);
            event.put("state", status == PackageInstaller.STATUS_FAILURE_ABORTED ? "cancelled" : status == PackageInstaller.STATUS_FAILURE_STORAGE ? "storage" : "refused");
        }
        notifyListeners("status", event);
    }
}
