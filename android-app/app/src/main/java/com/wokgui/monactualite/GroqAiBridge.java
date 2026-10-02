package com.wokgui.monactualite;

import android.app.Activity;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** Single, fixed Groq endpoint; encrypted private key never returned to JS. */
final class GroqAiBridge {
    private static final String ORIGIN = "https://mon-actualite.vercel.app", ALIAS = "MonActualiteGroq-v1";
    private final Activity activity;
    private final AtomicFile file;
    private final Object lock = new Object();
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor();
    private JSONObject vault;
    private boolean generating;
    private volatile boolean destroyed;
    private volatile HttpsURLConnection inference;
    private long epoch;

    GroqAiBridge(Activity activity, WebView view) {
        this.activity = activity;
        file = new AtomicFile(new File(activity.getNoBackupFilesDir(), "groq-ai-v1.enc"));
        try { vault = readVault(); } catch (Exception ignored) { vault = null; }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(view, "MonActualiteGroq", Collections.singleton(ORIGIN), (webView, message, sourceOrigin, mainFrame, reply) -> {
            if (!mainFrame || !ORIGIN.equals(sourceOrigin.toString()) || !isAppPage(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()))) return;
            String text = message.getData();
            if (text == null || text.length() > 240000 || destroyed) return;
            executor.execute(() -> dispatch(text, reply));
        });
    }
    static boolean isAppPage(Uri uri) {
        return "https".equals(uri.getScheme()) && "mon-actualite.vercel.app".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && "/assets/index.html".equals(uri.getPath());
    }
    private JSONObject status() throws Exception {
        synchronized (lock) {
            if (vault == null) throw new Exception("La clé chiffrée est inaccessible. Aucune clé n’a été écrasée.");
            return new JSONObject().put("configured", !vault.optString("key").isEmpty()).put("credentialVersion", vault.optString("version"));
        }
    }
    private void dispatch(String text, JavaScriptReplyProxy reply) {
        String id = "";
        try {
            JSONObject request = new JSONObject(text); id = request.getString("id");
            if (!id.matches("[A-Za-z0-9-]{1,80}")) return;
            JSONObject data;
            switch (request.optString("action")) {
                case "status": data = status(); break;
                case "configure":
                    synchronized (lock) {
                        status(); if (generating) throw new Exception("Attends la fin de la synthèse.");
                        JSONObject next = new JSONObject().put("key", GroqBrief.key(request.getString("key"))).put("version", UUID.randomUUID().toString());
                        saveVault(next); vault = next; epoch++;
                    }
                    data = status(); break;
                case "disconnect":
                    synchronized (lock) {
                        JSONObject next = new JSONObject().put("key", "").put("version", "");
                        saveVault(next); vault = next; epoch++; if (inference != null) inference.disconnect();
                    }
                    data = status(); break;
                case "generate": data = generate(request); break;
                default: throw new Exception("Demande Groq inconnue.");
            }
            respond(reply, new JSONObject().put("id", id).put("ok", true).put("data", data));
        } catch (Exception error) {
            String safe = error.getClass() == Exception.class ? error.getMessage() : null;
            if (error instanceof java.net.UnknownHostException) safe = "Impossible de joindre Groq (DNS). La dernière synthèse est conservée.";
            if (safe == null || safe.length() > 300 || safe.contains("gsk_")) safe = "La demande Groq a échoué. Vérifie la connexion ; la dernière synthèse est conservée.";
            // No raw provider errors, response bodies, credentials or logs.
            try { respond(reply, new JSONObject().put("id", id).put("ok", false).put("error", safe)); } catch (Exception ignored) {}
        }
    }
    private JSONObject generate(JSONObject input) throws Exception {
        JSONObject body = GroqBrief.request(input);
        String key, version; long expected;
        synchronized (lock) {
            status(); if (vault.optString("key").isEmpty()) throw new Exception("Enregistre une clé Groq dans les réglages.");
            if (generating) throw new Exception("Une synthèse est déjà en cours.");
            long elapsed = System.currentTimeMillis() - vault.optLong("attemptAt");
            if (!input.optBoolean("force") && elapsed >= 0 && elapsed < 3600000) throw new Exception("Une demande récente a déjà été envoyée. Réessaie plus tard.");
            JSONObject next = new JSONObject(vault.toString()).put("attemptAt", System.currentTimeMillis());
            saveVault(next); vault = next;
            key = vault.getString("key"); version = vault.getString("version"); expected = epoch; generating = true;
        }
        HttpsURLConnection connection = null; ScheduledFuture<?> deadline = null;
        try {
            connection = (HttpsURLConnection)new URL("https://api.groq.com/openai/v1/chat/completions").openConnection();
            inference = connection;
            connection.setConnectTimeout(12000); connection.setReadTimeout(45000); connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Authorization", "Bearer " + key);
            connection.setRequestProperty("Accept", "application/json");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(bytes.length);
            HttpsURLConnection current = connection;
            deadline = deadlines.schedule(current::disconnect, 55, TimeUnit.SECONDS);
            synchronized (lock) { if (destroyed || expected != epoch) throw new Exception("Demande annulée."); }
            try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            int http = connection.getResponseCode();
            if (http != 200) throw new Exception(GroqBrief.httpError(http));
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (InputStream stream = connection.getInputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = stream.read(buffer)) != -1) {
                    if (output.size() + count > 500000) throw new Exception("Réponse Groq trop longue.");
                    output.write(buffer, 0, count);
                }
            }
            JSONObject result = GroqBrief.result(new JSONObject(output.toString(StandardCharsets.UTF_8.name())), input.getJSONArray("articles"));
            synchronized (lock) {
                if (destroyed || expected != epoch) throw new Exception("La connexion a changé. Résultat ignoré.");
            }
            return new JSONObject().put("result", result).put("model", GroqBrief.MODEL).put("credentialVersion", version);
        } finally {
            if (deadline != null) deadline.cancel(false);
            if (connection != null) connection.disconnect(); inference = null;
            synchronized (lock) { generating = false; }
        }
    }
    private void respond(JavaScriptReplyProxy reply, JSONObject response) {
        activity.runOnUiThread(() -> { if (!destroyed) reply.postMessage(response.toString()); });
    }
    private SecretKey storageKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey)store.getKey(ALIAS, null);
    }
    private JSONObject readVault() throws Exception {
        if (!file.getBaseFile().exists()) return new JSONObject().put("key", "").put("version", "");
        JSONObject envelope = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, storageKey(), new GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
    }
    private void saveVault(JSONObject next) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, storageKey());
        JSONObject envelope = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(next.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
        FileOutputStream output = file.startWrite();
        try { output.write(envelope.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(output); }
        catch (Exception error) { file.failWrite(output); throw error; }
    }
    void destroy() { synchronized (lock) { destroyed = true; epoch++; } if (inference != null) inference.disconnect(); executor.shutdownNow(); deadlines.shutdownNow(); }
}
