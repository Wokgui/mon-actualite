package com.wokgui.monactualite;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class GroqBriefTest {
    private JSONObject input() throws Exception {
        return new JSONObject().put("prompt", "Résumé VR et voitures")
            .put("articles", new JSONArray().put(new JSONObject().put("sourceId","A1").put("title","Une innovation")
                .put("summary","Fait fourni").put("source","Source").put("category","VR").put("publishedAt","2026-10-02T10:00:00Z")
                .put("url","https://evil.test").put("image","https://evil.test/photo")));
    }
    private JSONObject response(String finish, String content) throws Exception {
        return new JSONObject().put("choices", new JSONArray().put(new JSONObject().put("finish_reason",finish).put("message",new JSONObject().put("content",content))));
    }
    @Test public void fixedModelStrictSchemaNoSecretsOrImages() throws Exception {
        JSONObject body = GroqBrief.request(input().put("key","SECRET").put("model","OTHER"));
        assertEquals("openai/gpt-oss-120b",body.getString("model")); assertFalse(body.getBoolean("stream"));
        assertTrue(body.getJSONObject("response_format").getJSONObject("json_schema").getBoolean("strict"));
        assertFalse(body.toString().contains("SECRET")); assertFalse(body.toString().contains("evil.test"));
        assertEquals(2200,body.getInt("max_completion_tokens"));
        assertTrue(body.getJSONArray("messages").getJSONObject(0).getString("content").contains("un paragraphe court par sujet"));
    }
    @Test public void validatesKeyWithoutEcho() throws Exception {
        assertEquals("gsk_abcdefghijklmnopqrstuv", GroqBrief.key(" gsk_abcdefghijklmnopqrstuv "));
        try { GroqBrief.key("PRIVATE-BAD-KEY"); fail(); } catch(Exception error) { assertFalse(error.getMessage().contains("PRIVATE-BAD-KEY")); }
    }
    @Test public void rejectsBlankPromptAndTooManySources() throws Exception {
        try { GroqBrief.request(input().put("prompt"," ")); fail(); } catch(Exception expected) {}
        JSONObject value = input(); JSONArray articles = value.getJSONArray("articles");
        for(int i=0;i<24;i++) articles.put(articles.getJSONObject(0));
        try { GroqBrief.request(value); fail(); } catch(Exception expected) {}
    }
    @Test public void rejectsSourceIdentifiersAndOversizedRequest() throws Exception {
        JSONObject value = input(); value.getJSONArray("articles").getJSONObject(0).put("sourceId","X");
        try { GroqBrief.request(value); fail(); } catch(Exception expected) {}
        value = input().put("prompt","a".repeat(6001));
        try { GroqBrief.request(value); fail(); } catch(Exception expected) {}
    }
    @Test public void acceptsCompleteSummaryAndRejectsTruncatedSseOrUnknownSources() throws Exception {
        String good = "{\"summary\":\"Résumé\",\"cards\":[{\"sourceId\":\"A1\",\"title\":\"Titre\",\"summary\":\"Faits\"}]}";
        assertEquals("Résumé",GroqBrief.result(response("stop",good),input().getJSONArray("articles")).getString("summary"));
        for(String finish : new String[]{"length","content_filter",""}) { try { GroqBrief.result(response(finish,good),input().getJSONArray("articles")); fail(); } catch(Exception expected) {} }
        try { GroqBrief.result(response("stop","data: [DONE]"),input().getJSONArray("articles")); fail(); } catch(Exception expected) {}
        try { GroqBrief.result(response("stop",good.replace("A1","A99")),input().getJSONArray("articles")); fail(); } catch(Exception expected) {}
    }
    @Test public void errorsAreActionableAndDoNotConfuseChatGPTQuotas() {
        assertTrue(GroqBrief.httpError(429).contains("Groq")); assertTrue(GroqBrief.httpError(401).contains("Clé"));
        assertFalse(GroqBrief.httpError(429).contains("ChatGPT")); assertTrue(GroqBrief.httpError(500).contains("conservée"));
    }
}
