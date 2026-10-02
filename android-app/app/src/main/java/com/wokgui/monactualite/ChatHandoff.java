package com.wokgui.monactualite;

import org.json.JSONObject;

/** Validates clipboard/browser handoffs. No authentication or inference capability. */
final class ChatHandoff {
    static String url(String provider) {
        switch (provider) {
            case "chatgpt": return "https://chatgpt.com/";
            case "claude": return "https://claude.ai/";
            case "gemini": return "https://gemini.google.com/";
            case "mistral": return "https://chat.mistral.ai/";
            case "perplexity": return "https://www.perplexity.ai/";
            case "grok": return "https://grok.com/";
            default: throw new IllegalArgumentException("Service de chat inconnu.");
        }
    }
    static void validate(JSONObject request) throws Exception {
        String id = request.getString("id"), action = request.getString("action"), text = request.getString("text");
        if (!id.matches("[a-zA-Z0-9-]{1,80}")) throw new IllegalArgumentException("Demande invalide.");
        if (!"copy".equals(action) && !"copy_and_open".equals(action)) throw new IllegalArgumentException("Action non autorisée.");
        if (text.trim().isEmpty() || text.length() > 100000) throw new IllegalArgumentException("Demande vide ou trop longue.");
        url(request.getString("provider"));
    }
}
