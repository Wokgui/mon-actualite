package com.wokgui.monactualite;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class ChatHandoffTest {
    private JSONObject request(String action, String provider, String text) throws Exception {
        return new JSONObject().put("id", "test-123").put("action", action).put("provider", provider).put("text", text);
    }
    @Test public void chatNormalOnly() throws Exception {
        assertEquals("https://chatgpt.com/", ChatHandoff.url("chatgpt"));
        ChatHandoff.validate(request("copy_and_open", "chatgpt", "Mon prompt"));
    }
    @Test public void allProviders() throws Exception {
        for (String provider : new String[]{"chatgpt", "claude", "gemini", "mistral", "perplexity", "grok"}) {
            assertTrue(ChatHandoff.url(provider).startsWith("https://"));
            ChatHandoff.validate(request("copy", provider, "Texte"));
        }
    }
    @Test(expected = IllegalArgumentException.class) public void rejectsInference() throws Exception { ChatHandoff.validate(request("generate", "chatgpt", "Texte")); }
    @Test(expected = IllegalArgumentException.class) public void rejectsArbitraryURL() throws Exception { ChatHandoff.validate(request("copy_and_open", "https://evil.test", "Texte")); }
    @Test(expected = IllegalArgumentException.class) public void rejectsEmptyText() throws Exception { ChatHandoff.validate(request("copy", "chatgpt", "   ")); }
    @Test(expected = IllegalArgumentException.class) public void rejectsOversize() throws Exception { ChatHandoff.validate(request("copy", "chatgpt", "x".repeat(100001))); }
}
