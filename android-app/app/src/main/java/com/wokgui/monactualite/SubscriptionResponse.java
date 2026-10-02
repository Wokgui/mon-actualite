package com.wokgui.monactualite;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.PushbackReader;
import java.io.Reader;
import java.util.Locale;
import org.json.JSONObject;

/** Verify the actual streaming protocol; never treat an HTTP label as a completed Brief. */
final class SubscriptionResponse {
    static JSONObject read(Reader input, int status, String contentType, String requestId) throws Exception {
        PushbackReader reader = new PushbackReader(new BufferedReader(input), 256);
        StringBuilder prefix = new StringBuilder();
        int value;
        while (prefix.length() < 128 && (value = reader.read()) != -1) {
            if (prefix.length() == 0 && value == 0xfeff) continue;
            prefix.append((char)value);
            if ((value == '\n' || value == '\r') && !prefix.toString().trim().isEmpty()) break;
        }
        String head = prefix.toString().trim();
        boolean sse = head.startsWith("data:") || head.startsWith("event:") || head.startsWith(":") || head.startsWith("id:") || head.startsWith("retry:");
        String shape = sse ? "SSE" : head.startsWith("<") ? "HTML" : head.startsWith("{") || head.startsWith("[") ? "JSON" : head.isEmpty() ? "vide" : "autre";
        if (status >= 200 && status < 300 && sse) {
            reader.unread(prefix.toString().toCharArray());
            try { return SubscriptionOAuth.completedResponse(reader); }
            catch (IOException error) {
                throw new IOException(error.getMessage() + " " + metadata(status, contentType, shape, requestId));
            } catch (Exception error) {
                throw new IOException("Le flux IA est mal formé. " + metadata(status, contentType, shape, requestId));
            }
        }
        JSONObject payload = null;
        if ("JSON".equals(shape)) {
            // Inspect only a bounded error object, never expose raw response text.
            while (prefix.length() < 16384 && (value = reader.read()) != -1) prefix.append((char)value);
            try { payload = new JSONObject(prefix.toString()); } catch (Exception ignored) {}
        }
        String detail = payload == null ? "" : safeCode(payload);
        String reason = detail.isEmpty() ? "HTML".equals(shape) ? "Le service a renvoyé une page Web, pas un résultat IA." : "Le service n’a pas renvoyé le flux IA attendu." : failureText(payload);
        throw new IOException(reason + " " + metadata(status, contentType, shape, requestId));
    }

    static String safeCode(JSONObject payload) {
        JSONObject response = payload.optJSONObject("response");
        JSONObject error = response == null ? payload.optJSONObject("error") : response.optJSONObject("error");
        String code = (error == null ? payload : error).optString("code");
        return code.matches("[a-z][a-z0-9_.-]{0,63}") ? code : "";
    }
    static String failureText(JSONObject payload) {
        String code = safeCode(payload);
        String text = code.equals("subscription_sharing_usage_limit_exceeded") ? "Limite d’utilisation atteinte. Consulte ton utilisation ChatGPT."
            : code.equals("subscription_sharing_user_not_eligible") ? "L’utilisation de l’abonnement n’est pas disponible pour ce compte."
            : code.equals("subscription_sharing_route_not_supported") ? "Cette route de génération n’est pas autorisée."
            : code.equals("subscription_sharing_usage_unavailable") || code.equals("subscription_sharing_user_unavailable") ? "Le service est temporairement indisponible. Ton compte est conservé."
            : code.equals("subscription_sharing_unsupported_capability") ? "Une option de génération n’est pas prise en charge."
            : "La génération IA n’a pas abouti.";
        return text + (code.isEmpty() ? "" : " Code : " + code + ".");
    }
    static String metadata(int status, String contentType, String shape, String requestId) {
        String mime = contentType == null ? "absent" : contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        if (contentType != null && (!mime.matches("[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+") || mime.length() > 48)) mime = "invalide";
        String reference = requestId != null && requestId.matches("[A-Za-z0-9_-]{1,48}") ? " · réf " + requestId.substring(0, Math.min(32, requestId.length())) : "";
        return "HTTP " + status + " · format " + mime + " · contenu " + shape + reference;
    }
}
