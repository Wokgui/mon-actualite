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
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceResponse;

import androidx.webkit.WebViewAssetLoader;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://mon-actualite.vercel.app/assets/index.html?native=98.03";
    private static final String APP_HOST = "mon-actualite.vercel.app";

    private FrameLayout root;
    private WebView webView;
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
            int wantedBottom = 0;

            if (wantedTop != lastTopInset || wantedBottom != lastBottomInset) {
                FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) webView.getLayoutParams();
                params.topMargin = wantedTop;
                params.bottomMargin = wantedBottom;
                webView.setLayoutParams(params);
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
        settings.setUserAgentString(settings.getUserAgentString() + " MonActualiteAndroid/98.3");

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
                if (APP_HOST.equalsIgnoreCase(uri.getHost())) return false;
                openExternal(uri);
                return true;
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (APP_HOST.equalsIgnoreCase(uri.getHost())) return false;
                openExternal(uri);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                applyAndroidHeaderPolish();
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

        if (savedInstanceState == null) webView.loadUrl(APP_URL);
        else webView.restoreState(savedInstanceState);
    }

    private void applyAndroidHeaderPolish() {
        String js = "(function(){if(document.getElementById('android-ui-polish-v94'))return;" +
            "var s=document.createElement('style');s.id='android-ui-polish-v94';" +
            "s.textContent='.hero-header{background:#F1F2FF!important}.settings-page-v9185>.page-masthead-v9186,.page:has(.brief-mode-tabs)>.page-masthead-v9186{background:#F1F2FF!important}.hero-header h1{font-size:32px!important;line-height:1.08!important;font-weight:840!important;letter-spacing:-.034em!important}" +
            ".page-masthead-v9186 h1,.settings-page-v9185>.page-masthead-v9186 h1,.page:has(.brief-mode-tabs)>.page-masthead-v9186 h1{font-size:25px!important;line-height:1.12!important;font-weight:820!important;letter-spacing:-.026em!important}';" +
            "document.head.appendChild(s);})();";
        webView.evaluateJavascript(js, null);
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
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
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
