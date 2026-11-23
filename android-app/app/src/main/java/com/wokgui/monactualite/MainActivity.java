package com.wokgui.monactualite;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.DisplayCutout;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceResponse;

import androidx.webkit.WebViewAssetLoader;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://mon-actualite.vercel.app/assets/index.html?native=98.69";
    private static final String APP_HOST = "mon-actualite.vercel.app";

    private FrameLayout root;
    private WebView webView;
    private WebView publisherView;
    private LinearLayout publisherPanel;
    private Button publisherMore;
    private Button publisherLess;
    private Button publisherBlock;
    private String publisherArticleId;
    private Uri publisherOriginal;
    private GroqAiBridge groqAI;
    private WebViewAssetLoader assetLoader;
    private int lastTopInset = -1;
    private int lastBottomInset = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(241, 242, 255));
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        );

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(241, 242, 255));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        root.addView(webView, webParams);

        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int safeTop;
            int safeBottom;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets systemBars = insets.getInsets(
                    WindowInsets.Type.statusBars()
                        | WindowInsets.Type.navigationBars()
                        | WindowInsets.Type.displayCutout()
                );
                safeTop = systemBars.top;
                safeBottom = systemBars.bottom;
            } else {
                safeTop = insets.getSystemWindowInsetTop();
                safeBottom = insets.getSystemWindowInsetBottom();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    DisplayCutout cutout = insets.getDisplayCutout();
                    if (cutout != null) {
                        safeTop = Math.max(safeTop, cutout.getSafeInsetTop());
                        safeBottom = Math.max(safeBottom, cutout.getSafeInsetBottom());
                    }
                }
            }

            int extraTop = Math.round(6f * getResources().getDisplayMetrics().density);
            int wantedTop = safeTop + extraTop;
            int wantedBottom = safeBottom;

            if (wantedTop != lastTopInset || wantedBottom != lastBottomInset) {
                FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) webView.getLayoutParams();
                params.topMargin = wantedTop;
                params.bottomMargin = wantedBottom;
                webView.setLayoutParams(params);
                if (publisherPanel != null) applyPublisherInsets(wantedTop, wantedBottom);
                lastTopInset = wantedTop;
                lastBottomInset = wantedBottom;
            }

            return insets;
        });

        setContentView(root);
        root.requestApplyInsets();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setUserAgentString(settings.getUserAgentString() + " MonActualiteAndroid/98.69");

        assetLoader = new WebViewAssetLoader.Builder()
            .setDomain(APP_HOST)
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse local = assetLoader.shouldInterceptRequest(request.getUrl());
                return local != null ? local : super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!request.isForMainFrame()) return false;
                if (handlePublisherRoute(view, uri)) return true;
                if (GroqAiBridge.isAppPage(uri)) return false;
                openExternal(uri);
                return true;
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (handlePublisherRoute(view, uri)) return true;
                if (GroqAiBridge.isAppPage(uri)) return false;
                openExternal(uri);
                return true;
            }

        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    private boolean handled = false;

                    private void handle(String url) {
                        if (handled || url == null || url.isEmpty() || "about:blank".equals(url)) return;
                        handled = true;
                        openExternal(Uri.parse(url));
                        popup.destroy();
                    }

                    @Override
                    public void onPageStarted(WebView v, String url, Bitmap favicon) {
                        handle(url);
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                        handle(request.getUrl().toString());
                        return true;
                    }

                    @Override
                    @SuppressWarnings("deprecation")
                    public boolean shouldOverrideUrlLoading(WebView v, String url) {
                        handle(url);
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });

        groqAI = new GroqAiBridge(this, webView);
        if (savedInstanceState == null) webView.loadUrl(APP_URL);
        else webView.restoreState(savedInstanceState);
    }

    private static boolean isWebPage(Uri uri) {
        return uri.getHost() != null
            && ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()));
    }

    private boolean handlePublisherRoute(WebView view, Uri route) {
        if (!"https".equals(route.getScheme()) || !APP_HOST.equals(route.getHost())
                || !"/assets/native-publisher".equals(route.getPath())) return false;
        String current = view.getUrl();
        String id = route.getQueryParameter("id");
        String url = route.getQueryParameter("url");
        if (current != null && GroqAiBridge.isAppPage(Uri.parse(current)) && id != null
                && !id.isEmpty() && url != null && isWebPage(Uri.parse(url))) {
            showPublisher(id, Uri.parse(url));
        }
        return true;
    }

    private Button toolbarButton(LinearLayout row, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(13);
        button.setOnClickListener(view -> action.run());
        row.addView(button, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        return button;
    }

    private void applyPublisherInsets(int top, int bottom) {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-1, -1);
        params.topMargin = Math.max(0, top);
        params.bottomMargin = Math.max(0, bottom);
        publisherPanel.setLayoutParams(params);
    }

    private void showPublisher(String id, Uri url) {
        closePublisher();
        publisherArticleId = id;
        publisherOriginal = url;
        publisherPanel = new LinearLayout(this);
        publisherPanel.setOrientation(LinearLayout.VERTICAL);
        publisherPanel.setBackgroundColor(Color.WHITE);

        LinearLayout navigation = new LinearLayout(this);
        publisherPanel.addView(navigation);
        toolbarButton(navigation, "Retour à l’application", this::closePublisher);
        toolbarButton(navigation, "Ouvrir dans le navigateur", () -> {
            String current = publisherView.getUrl();
            Uri destination = current == null ? publisherOriginal : Uri.parse(current);
            openExternal(isWebPage(destination) ? destination : publisherOriginal);
        });

        LinearLayout preferences = new LinearLayout(this);
        publisherPanel.addView(preferences);
        publisherMore = toolbarButton(preferences, "Plus comme ça", () -> applyPublisherPreference("more"));
        publisherLess = toolbarButton(preferences, "Moins comme ça", () -> applyPublisherPreference("less"));
        publisherBlock = toolbarButton(preferences, "Masquer la source", () -> applyPublisherPreference("block"));
        publisherView = new WebView(this);
        WebSettings settings = publisherView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        publisherView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request.isForMainFrame() && !isWebPage(request.getUrl());
            }
        });
        publisherPanel.addView(publisherView, new LinearLayout.LayoutParams(-1, 0, 1));
        root.addView(publisherPanel);
        applyPublisherInsets(lastTopInset, lastBottomInset);
        webView.setVisibility(View.INVISIBLE);
        publisherView.loadUrl(url.toString());
        applyPublisherPreference("");
    }

    private void applyPublisherPreference(String action) {
        String id = publisherArticleId;
        WebView current = publisherView;
        if (id == null || current == null) return;
        webView.evaluateJavascript(
            "window.newsPublisherPreference?.(" + JSONObject.quote(id) + "," + JSONObject.quote(action) + ")",
            value -> {
                if (publisherView != current || value == null || "null".equals(value)) return;
                try {
                    JSONObject result = new JSONObject(value);
                    String feedback = result.optString("feedback");
                    boolean blocked = result.optBoolean("blocked");
                    publisherMore.setText("more".equals(feedback) ? "✓ Plus comme ça" : "Plus comme ça");
                    publisherLess.setText("less".equals(feedback) ? "✓ Moins comme ça" : "Moins comme ça");
                    publisherBlock.setEnabled(result.optBoolean("hasSource"));
                    publisherBlock.setText(blocked ? "Rétablir la source" : "Masquer la source");
                    if ("block".equals(action)) Toast.makeText(this, blocked ? "Source masquée" : "Source rétablie", Toast.LENGTH_SHORT).show();
                } catch (JSONException ignored) {}
            });
    }

    private void closePublisher() {
        if (publisherPanel == null) return;
        root.removeView(publisherPanel);
        publisherPanel.removeView(publisherView);
        publisherView.stopLoading();
        publisherView.destroy();
        publisherView = null;
        publisherPanel = null;
        publisherArticleId = null;
        publisherOriginal = null;
        webView.setVisibility(View.VISIBLE);
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (webView != null && Uri.parse("monactualite://brief/ia").equals(intent.getData())) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (publisherView != null) {
            if (publisherView.canGoBack()) publisherView.goBack();
            else closePublisher();
            return;
        }
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        closePublisher();
        if (groqAI != null) groqAI.destroy();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
