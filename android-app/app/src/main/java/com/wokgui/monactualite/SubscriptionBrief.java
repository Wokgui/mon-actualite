package com.wokgui.monactualite;

import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONObject;

/** Keep wire-event decoding separate from the model's structured result. */
final class SubscriptionBrief {
    static JSONObject textFormat() throws Exception {
        JSONObject string = new JSONObject().put("type", "string");
        JSONObject card = new JSONObject().put("type", "object").put("additionalProperties", false)
            .put("properties", new JSONObject().put("sourceId", string).put("title", string).put("summary", string))
            .put("required", new JSONArray().put("sourceId").put("title").put("summary"));
        JSONObject schema = new JSONObject().put("type", "object").put("additionalProperties", false)
            .put("properties", new JSONObject().put("summary", string).put("cards", new JSONObject().put("type", "array").put("items", card)))
            .put("required", new JSONArray().put("summary").put("cards"));
        return new JSONObject().put("format", new JSONObject().put("type", "json_schema").put("name", "mon_actualite_brief").put("strict", true).put("schema", schema));
    }
    static JSONObject completed(JSONObject response) throws IOException {
        StringBuilder output = new StringBuilder();
        JSONArray items = response.optJSONArray("output");
        if (items == null) throw new IOException("Réponse terminée sans contenu exploitable. Étape : réponse complète.");
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) throw new IOException("Structure de réponse invalide. Étape : réponse complète.");
            JSONArray content = item.optJSONArray("content");
            if (content == null) continue;
            for (int j = 0; j < content.length(); j++) {
                JSONObject part = content.optJSONObject(j);
                if (part == null) throw new IOException("Structure de contenu invalide. Étape : réponse complète.");
                if ("refusal".equals(part.optString("type"))) throw new IOException("L’IA a refusé cette demande. Le résultat précédent est conservé.");
                if ("output_text".equals(part.optString("type"))) output.append(part.optString("text"));
                if (output.length() > 160000) throw new IOException("Réponse IA trop longue.");
            }
        }
        String text = output.toString().trim();
        if (text.isEmpty()) throw new IOException("Réponse terminée sans texte. Étape : résultat IA.");
        if (text.startsWith("```")) { int start = text.indexOf('\n'), end = text.lastIndexOf("```"); if (start >= 0 && end > start) text = text.substring(start + 1, end).trim(); }
        JSONObject result;
        try { result = new JSONObject(text); }
        catch (Exception error) { throw new IOException("L’IA a terminé mais son résultat n’est pas au format demandé. Étape : résultat JSON."); }
        if (!(result.opt("summary") instanceof String) || result.optJSONArray("cards") == null)
            throw new IOException("Le résultat IA ne contient pas le résumé et les articles attendus. Étape : structure du Brief.");
        JSONArray cards = result.optJSONArray("cards");
        for (int i = 0; i < cards.length(); i++) {
            JSONObject card = cards.optJSONObject(i);
            if (card == null || !(card.opt("sourceId") instanceof String) || !(card.opt("title") instanceof String) || !(card.opt("summary") instanceof String))
                throw new IOException("Un article IA n’a pas la structure attendue. Étape : structure du Brief.");
        }
        return result;
    }
}
