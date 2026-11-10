package com.ultraiptv.player;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * The catalogue's files for Fast loading (packages/core/src/catalog/fileStore.ts), in the app's
 * private folder: the same operations Samsung's file API gives the TV build. Calls run one at a
 * time on Capacitor's plugin thread, so appends land in the order they were sent.
 */
@CapacitorPlugin(name = "UltraFiles")
public class UltraFilesPlugin extends Plugin {
    private static final Pattern NAME = Pattern.compile("^[\\w.\\-|~]+$");

    private File root() {
        return new File(getContext().getFilesDir(), "catalog");
    }

    /** A relative path of plain names only, so nothing can reach outside the catalogue folder. */
    private File resolve(String path) throws IOException {
        if (path == null || path.isEmpty()) throw new IOException("Bad catalogue path");
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..") || !NAME.matcher(part).matches()) {
                throw new IOException("Bad catalogue path: " + path);
            }
        }
        return new File(root(), path);
    }

    private void writeText(File file, String text, boolean append) throws IOException {
        File dir = file.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) throw new IOException("Could not make " + dir.getName());
        try (Writer out = new OutputStreamWriter(new FileOutputStream(file, append), StandardCharsets.UTF_8)) {
            out.write(text);
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        try {
            writeText(resolve(call.getString("path")), call.getString("text", ""), false);
            call.resolve();
        } catch (IOException e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void append(PluginCall call) {
        try {
            boolean start = Boolean.TRUE.equals(call.getBoolean("start", false));
            writeText(resolve(call.getString("path")), call.getString("text", ""), !start);
            call.resolve();
        } catch (IOException e) {
            call.reject(e.getMessage());
        }
    }

    /** `count` code points (an emoji is one) starting `offset` UTF-8 bytes in, like the TV's readString after seek. */
    @PluginMethod
    public void readSlice(PluginCall call) {
        try {
            File file = resolve(call.getString("path"));
            JSObject result = new JSObject();
            if (!file.isFile()) {
                call.resolve(result);
                return;
            }
            // Read as plain numbers: Capacitor's getLong ignores a value that arrives as an integer.
            long offset = call.getData().optLong("offset", 0L);
            int count = call.getData().optInt("count", 0);
            StringBuilder text = new StringBuilder(Math.min(Math.max(count, 16), 1 << 20));
            try (FileInputStream in = new FileInputStream(file)) {
                long skipped = 0;
                while (skipped < offset) {
                    long n = in.skip(offset - skipped);
                    if (n <= 0) break;
                    skipped += n;
                }
                BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8), 64 * 1024);
                int points = 0;
                while (points < count) {
                    int c = reader.read();
                    if (c < 0) break;
                    text.append((char) c);
                    if (Character.isHighSurrogate((char) c)) {
                        int low = reader.read();
                        if (low >= 0) text.append((char) low);
                    }
                    points++;
                }
            }
            result.put("text", text.toString());
            call.resolve(result);
        } catch (IOException e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        try {
            File file = resolve(call.getString("path"));
            JSObject result = new JSObject();
            if (file.isFile()) {
                byte[] bytes = new byte[(int) file.length()];
                try (FileInputStream in = new FileInputStream(file)) {
                    int done = 0;
                    while (done < bytes.length) {
                        int n = in.read(bytes, done, bytes.length - done);
                        if (n < 0) break;
                        done += n;
                    }
                }
                result.put("text", new String(bytes, StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch (IOException e) {
            call.reject(e.getMessage());
        }
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    @PluginMethod
    public void removeDir(PluginCall call) {
        try {
            File dir = resolve(call.getString("path"));
            if (dir.exists()) deleteTree(dir);
            call.resolve();
        } catch (IOException e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void freeBytes(PluginCall call) {
        JSObject result = new JSObject();
        result.put("bytes", getContext().getFilesDir().getUsableSpace());
        call.resolve(result);
    }
}
