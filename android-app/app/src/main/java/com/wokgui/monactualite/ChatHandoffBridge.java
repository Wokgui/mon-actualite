package com.wokgui.monactualite;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;
import org.json.JSONObject;

/** Local clipboard write and external chat launch; never reads clipboard or sends an AI request. */
final class ChatHandoffBridge {
    private static final String ORIGIN = "https://mon-actualite.vercel.app";
    static boolean isAppPage(Uri uri) {
        return "https".equals(uri.getScheme()) && "mon-actualite.vercel.app".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && "/assets/index.html".equals(uri.getPath());
    }
    static void install(Activity activity, WebView webView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(webView, "MonActualiteChat", Collections.singleton(ORIGIN),
            (view, message, origin, mainFrame, reply) -> {
                if (!mainFrame || !ORIGIN.equals(origin.toString()) || !isAppPage(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) return;
                String raw = message.getData();
                if (raw == null || raw.length() > 650000) return; // JSON escaping can expand the bounded text.
                JSONObject response = new JSONObject();
                try {
                    JSONObject request = new JSONObject(raw);
                    response.put("id", request.optString("id"));
                    ChatHandoff.validate(request);
                    ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                    if (clipboard == null) throw new IllegalStateException();
                    clipboard.setPrimaryClip(ClipData.newPlainText("Demande Mon Actualité", request.getString("text")));
                    if ("copy_and_open".equals(request.getString("action"))) {
                        activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(ChatHandoff.url(request.getString("provider")))));
                    }
                    response.put("ok", true);
                } catch (Exception error) {
                    try { response.put("ok", false); response.put("error", "Ouverture ou copie impossible. Sélectionne la demande pour la copier, puis utilise le lien vers ton chat."); } catch (Exception ignored) {}
                }
                reply.postMessage(response.toString());
            });
    }
}
