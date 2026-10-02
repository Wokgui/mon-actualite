package com.wokgui.monactualite;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.Reader;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.util.Base64;

/** Provider protocol rules, isolated from Android so CI tests the real code. */
final class SubscriptionOAuth {
    static final String ISSUER = "https://auth.openai.com";
    static final String RESOURCE = "https://api.openai.com/v1";
    static final String PLAN_SCOPE = "chatgpt.tokens.use.direct";
    static final String SCOPES = "openid profile email offline_access resource.invoke " + PLAN_SCOPE;
    static String hostId(String saved) throws Exception {
        String uuid = saved.startsWith("urn:uuid:") ? saved.substring(9) : saved;
        if (!uuid.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) throw new Exception("Identifiant de l’installation invalide.");
        // Preserve the existing UUID; migrate its representation, not its identity.
        return saved.startsWith("urn:uuid:") ? saved : "urn:uuid:" + uuid;
    }
    static byte[] decode(String text) { return Base64.getUrlDecoder().decode(text); }
    static String encode(byte[] bytes) { return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    static boolean equal(String a, String b) {
        return a != null && b != null && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
    static boolean planEnabled(String scopes) {
        for (String scope : scopes.split("\\s+")) if (PLAN_SCOPE.equals(scope)) return true;
        return false;
    }
    static String issuedClient(String returning, String issued) throws Exception {
        String result = issued.isEmpty() ? returning : issued;
        if (!result.startsWith("oaiapp_") || (!returning.isEmpty() && !equal(returning, result))) throw new Exception("Identité de l’application invalide.");
        return result;
    }
    static JSONObject verifyIdentity(String jwt, JSONObject jwks, String client, String nonce, long now) throws Exception {
        String[] parts = jwt.split("\\.");
        if (parts.length != 3) throw new Exception("Identité invalide.");
        JSONObject header = new JSONObject(new String(decode(parts[0]), StandardCharsets.UTF_8));
        if (!"RS256".equals(header.optString("alg")) || header.optString("kid").isEmpty()) throw new Exception("Signature invalide.");
        JSONObject key = null;
        JSONArray keys = jwks.getJSONArray("keys");
        for (int i = 0; i < keys.length(); i++) {
            JSONObject candidate = keys.getJSONObject(i);
            if (equal(header.optString("kid"), candidate.optString("kid")) && "RSA".equals(candidate.optString("kty")) && "sig".equals(candidate.optString("use", "sig"))) key = candidate;
        }
        if (key == null) throw new Exception("Clé de signature inconnue.");
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initVerify(KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(new BigInteger(1, decode(key.getString("n"))), new BigInteger(1, decode(key.getString("e"))))));
        signature.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        if (!signature.verify(decode(parts[2]))) throw new Exception("Signature invalide.");
        JSONObject claims = new JSONObject(new String(decode(parts[1]), StandardCharsets.UTF_8));
        Object aud = claims.opt("aud");
        boolean audience = client.equals(aud);
        if (aud instanceof JSONArray) { JSONArray array = (JSONArray) aud; for (int i = 0; i < array.length(); i++) audience |= client.equals(array.optString(i)); }
        if (!ISSUER.equals(claims.optString("iss")) || !audience || claims.optLong("exp") <= now || claims.optLong("iat", now) > now + 60
            || claims.optLong("nbf", 0) > now + 60 || !equal(nonce, claims.optString("nonce")) || claims.optString("sub").isEmpty()
            || (aud instanceof JSONArray && ((JSONArray)aud).length() > 1 && !client.equals(claims.optString("azp")))) throw new Exception("Identité expirée ou destinée à une autre application.");
        return claims;
    }
    static JSONObject completedResponse(Reader input) throws Exception {
        BufferedReader reader = new BufferedReader(input);
        StringBuilder data = new StringBuilder();
        int[] bytes = {0};
        String line;
        while ((line = streamLine(reader, bytes)) != null) {
            if (!line.isEmpty()) {
                if (line.startsWith("data:")) {
                    if (data.length() > 0) data.append('\n');
                    String field = line.substring(5);
                    data.append(field.startsWith(" ") ? field.substring(1) : field);
                }
                continue;
            }
            if (data.length() == 0) continue;
            String eventText = data.toString(); data.setLength(0);
            if ("[DONE]".equals(eventText)) break;
            JSONObject event = new JSONObject(eventText);
            String type = event.optString("type");
            if (type.equals("response.failed") || type.equals("response.incomplete") || type.equals("error")) throw new IOException(SubscriptionResponse.failureText(event));
            if (!type.equals("response.completed")) continue;
            JSONObject response = event.getJSONObject("response");
            if (!"completed".equals(response.optString("status"))) throw new IOException("Génération incomplète.");
            StringBuilder output = new StringBuilder();
            JSONArray items = response.getJSONArray("output");
            for (int i = 0; i < items.length(); i++) {
                JSONArray content = items.getJSONObject(i).optJSONArray("content");
                if (content == null) continue;
                for (int j = 0; j < content.length(); j++) { JSONObject part = content.getJSONObject(j); if ("output_text".equals(part.optString("type"))) output.append(part.optString("text")); }
            }
            if (output.length() > 160000) throw new IOException("Réponse IA trop longue.");
            String text = output.toString().trim();
            if (text.startsWith("```")) { int start = text.indexOf('\n'); int end = text.lastIndexOf("```"); if (start >= 0 && end > start) text = text.substring(start + 1, end).trim(); }
            return new JSONObject(text);
        }
        throw new IOException("Génération interrompue : le résultat précédent est conservé.");
    }
    private static String streamLine(BufferedReader reader, int[] count) throws IOException {
        StringBuilder line = new StringBuilder(); int value;
        while ((value = reader.read()) != -1) {
            if (++count[0] > 2000000) throw new IOException("Réponse IA trop longue.");
            if (value == '\n') return line.toString();
            if (value == '\r') {
                reader.mark(1); int next = reader.read();
                if (next == '\n') { if (++count[0] > 2000000) throw new IOException("Réponse IA trop longue."); }
                else if (next != -1) reader.reset();
                return line.toString();
            }
            line.append((char)value);
        }
        return line.length() == 0 ? null : line.toString();
    }
}
