package com.wokgui.monactualite;

import java.io.IOException;
import java.io.StringReader;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class SubscriptionResponseTest {
    private JSONObject completed() throws Exception {
        JSONObject result = new JSONObject().put("summary", "Synthèse").put("cards", new JSONArray());
        JSONObject response = new JSONObject().put("status", "completed").put("output", new JSONArray().put(new JSONObject().put("content", new JSONArray().put(new JSONObject().put("type", "output_text").put("text", result.toString())))));
        return new JSONObject().put("type", "response.completed").put("response", response);
    }
    private String stream() throws Exception { return "event: response.completed\ndata: " + completed() + "\n\n"; }
    private JSONObject read(String body, int status, String mime) throws Exception { return SubscriptionResponse.read(new StringReader(body), status, mime, "req_fixture"); }
    private String rejected(String body, int status, String mime) {
        IOException error = assertThrows(IOException.class, () -> read(body, status, mime));
        assertTrue("diagnostic fits the native dispatch limit", error.getMessage().length() <= 300);
        assertFalse(error.getMessage().contains("SECRET"));
        return error.getMessage();
    }
    @Test public void acceptsCompletedSse() throws Exception { assertEquals("Synthèse", read(stream(), 200, "text/event-stream; charset=utf-8").getString("summary")); }
    @Test public void readsActualSseEvenWithIncorrectLabel() throws Exception { assertEquals("Synthèse", read(stream(), 200, "application/json").getString("summary")); }
    @Test public void readsActualSseWithoutLabel() throws Exception { assertEquals("Synthèse", read(stream(), 200, null).getString("summary")); }
    @Test public void acceptsBomCommentsAndCrlf() throws Exception { assertEquals("Synthèse", read("\ufeff: heartbeat\r\n\r\n" + stream().replace("\n", "\r\n"), 200, "text/event-stream").getString("summary")); }
    @Test public void acceptsCrDelimitedSse() throws Exception { assertEquals("Synthèse", read(stream().replace("\n", "\r"), 200, "text/event-stream").getString("summary")); }
    @Test public void acceptsMultilineDataFields() throws Exception {
        String event = completed().toString().replace("\"response\":", "\n\"response\":");
        assertEquals("Synthèse", read("data: " + event.replace("\n", "\ndata: ") + "\n\n", 200, "text/event-stream").getString("summary"));
    }
    @Test public void rejectsHtmlRegardlessOfLabel() { assertTrue(rejected("<!doctype html>SECRET", 200, "text/event-stream").contains("contenu HTML")); }
    @Test public void rejectsNonStreamingCompletedJson() throws Exception { assertTrue(rejected(completed().toString(), 200, "application/json").contains("flux IA attendu")); }
    @Test public void reportsExactQuotaCode() { assertTrue(rejected("{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\",\"message\":\"SECRET\"}}", 429, "application/json").contains("HTTP 429")); }
    @Test public void preservesEligibilityCode() { assertTrue(rejected("{\"code\":\"subscription_sharing_user_not_eligible\",\"detail\":\"SECRET\"}", 403, "application/json").contains("subscription_sharing_user_not_eligible")); }
    @Test public void preservesUnsupportedCapabilityCode() { assertTrue(rejected("{\"error\":{\"code\":\"subscription_sharing_unsupported_capability\"}}", 400, "application/json").contains("option de génération")); }
    @Test public void temporaryFailureIsNotQuotaOrDisconnection() { String message = rejected("{\"code\":\"subscription_sharing_usage_unavailable\"}", 503, "application/json"); assertTrue(message.contains("compte est conservé")); assertFalse(message.contains("Limite")); }
    @Test public void partialStreamCannotBecomeSuccess() { assertTrue(rejected("data: {\"type\":\"response.output_text.delta\",\"delta\":\"SECRET\"}\n\ndata: [DONE]\n\n", 200, "text/event-stream").contains("interrompue")); }
    @Test public void terminalIncompleteCannotBecomeSuccess() { rejected("data: {\"type\":\"response.incomplete\",\"response\":{\"error\":{\"code\":\"max_output_tokens\"}}}\n\n", 200, "text/event-stream"); }
    @Test public void terminalFailureRetainsCorrectCode() { assertTrue(rejected("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_route_not_supported\"}}}\n\n", 200, "text/event-stream").contains("subscription_sharing_route_not_supported")); }
    @Test public void malformedStreamIsSafelyDiagnosed() { assertTrue(rejected("data: {SECRET}\n\n", 200, "text/event-stream").contains("mal formé")); }
    @Test public void emptyResponseIsDiagnosed() { assertTrue(rejected("", 200, null).contains("format absent · contenu vide")); }
    @Test public void metadataCannotInjectPrivateText() { String message = SubscriptionResponse.metadata(403, "SECRET\r\nx/header", "JSON", "SECRET\r\nheader"); assertFalse(message.contains("SECRET")); assertFalse(message.contains("\n")); }
    @Test public void unsafeErrorCodeIsNotExposed() { rejected("{\"code\":\"SECRET/private-token\"}", 400, "application/json"); }
    @Test public void oversizedStreamIsBounded() { assertTrue(rejected("data: " + "x".repeat(2000001) + "\n\n", 200, "text/event-stream").contains("trop longue")); }
    @Test public void oversizedErrorBodyIsNotExposed() { rejected("{\"detail\":\"SECRET" + "x".repeat(20000) + "\"}", 403, "application/json"); }
    @Test public void longSafeMetadataFitsDispatchLimit() throws Exception {
        String body = "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_user_not_eligible\"}}}\n\n";
        IOException error = assertThrows(IOException.class, () -> SubscriptionResponse.read(new StringReader(body), 200, "application/" + "x".repeat(36), "r".repeat(48)));
        assertTrue(error.getMessage(), error.getMessage().length() <= 300);
    }
}
