package com.wokgui.monactualite;

import org.junit.Before;
import org.junit.Test;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.StringReader;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.util.Arrays;
import static org.junit.Assert.*;

public class SubscriptionOAuthTest {
    @Test public void migratesBareHostUuidWithoutChangingIt() throws Exception { assertEquals("urn:uuid:3b539c06-5860-4450-a848-c1f876184c02", SubscriptionOAuth.hostId("3b539c06-5860-4450-a848-c1f876184c02")); }
    @Test public void hostMigrationIsIdempotent() throws Exception { String value = "urn:uuid:3b539c06-5860-4450-a848-c1f876184c02"; assertEquals(value, SubscriptionOAuth.hostId(SubscriptionOAuth.hostId(value))); }
    @Test public void rejectsInvalidHostIds() { for (String invalid : new String[]{"", "user@example.test", "urn:uuid:wrong", "3b539c06-5860-1450-a848-c1f876184c02"}) assertThrows(Exception.class, () -> SubscriptionOAuth.hostId(invalid)); }
    private KeyPair pair;
    private JSONObject jwks, claims;
    @Before public void prepare() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048); pair = generator.generateKeyPair();
        RSAPublicKey publicKey = (RSAPublicKey)pair.getPublic();
        jwks = new JSONObject().put("keys", new JSONArray().put(new JSONObject().put("kid", "test").put("kty", "RSA").put("use", "sig").put("n", unsigned(publicKey.getModulus())).put("e", unsigned(publicKey.getPublicExponent()))));
        claims = new JSONObject().put("iss", SubscriptionOAuth.ISSUER).put("aud", "oaiapp_test").put("sub", "subject").put("nonce", "nonce").put("iat", 900).put("exp", 1100);
    }
    private String unsigned(BigInteger number) { byte[] bytes = number.toByteArray(); return SubscriptionOAuth.encode(bytes[0] == 0 ? Arrays.copyOfRange(bytes, 1, bytes.length) : bytes); }
    private String token(String alg) throws Exception {
        String head = SubscriptionOAuth.encode(new JSONObject().put("alg", alg).put("kid", "test").toString().getBytes(StandardCharsets.UTF_8));
        String payload = SubscriptionOAuth.encode(claims.toString().getBytes(StandardCharsets.UTF_8));
        Signature signature = Signature.getInstance("SHA256withRSA"); signature.initSign(pair.getPrivate()); signature.update((head + "." + payload).getBytes(StandardCharsets.US_ASCII));
        return head + "." + payload + "." + SubscriptionOAuth.encode(signature.sign());
    }
    @Test public void verifiesRealRsaSignature() throws Exception { assertEquals("subject", SubscriptionOAuth.verifyIdentity(token("RS256"), jwks, "oaiapp_test", "nonce", 1000).getString("sub")); }
    @Test public void rejectsWrongNonce() throws Exception { assertThrows(Exception.class, () -> SubscriptionOAuth.verifyIdentity(token("RS256"), jwks, "oaiapp_test", "wrong", 1000)); }
    @Test public void rejectsWrongAudience() throws Exception { assertThrows(Exception.class, () -> SubscriptionOAuth.verifyIdentity(token("RS256"), jwks, "oaiapp_other", "nonce", 1000)); }
    @Test public void rejectsExpired() throws Exception { assertThrows(Exception.class, () -> SubscriptionOAuth.verifyIdentity(token("RS256"), jwks, "oaiapp_test", "nonce", 1100)); }
    @Test public void rejectsForeignIssuer() throws Exception { claims.put("iss", "https://evil.test"); assertThrows(Exception.class, () -> SubscriptionOAuth.verifyIdentity(token("RS256"), jwks, "oaiapp_test", "nonce", 1000)); }
    @Test public void rejectsUnsignedAlgorithm() throws Exception { assertThrows(Exception.class, () -> SubscriptionOAuth.verifyIdentity(token("none"), jwks, "oaiapp_test", "nonce", 1000)); }
    @Test public void rejectsChangedSignature() throws Exception { String jwt = token("RS256"); jwt = jwt.substring(0, jwt.lastIndexOf('.') + 1) + SubscriptionOAuth.encode(new byte[256]); final String bad = jwt; assertThrows(Exception.class, () -> SubscriptionOAuth.verifyIdentity(bad, jwks, "oaiapp_test", "nonce", 1000)); }
    @Test public void acceptsIssuedReturningId() throws Exception { assertEquals("oaiapp_test", SubscriptionOAuth.issuedClient("oaiapp_test", "")); }
    @Test public void rejectsIncompleteDynamicRegistration() { assertThrows(Exception.class, () -> SubscriptionOAuth.issuedClient("", "")); assertThrows(Exception.class, () -> SubscriptionOAuth.issuedClient("", "dynamic_agent_client")); }
    @Test public void rejectsRegistrationSwap() { assertThrows(Exception.class, () -> SubscriptionOAuth.issuedClient("oaiapp_one", "oaiapp_two")); }
    @Test public void scopesAreExactPermissions() { assertTrue(SubscriptionOAuth.planEnabled(SubscriptionOAuth.SCOPES)); assertFalse(SubscriptionOAuth.planEnabled("openid profile email")); assertFalse(SubscriptionOAuth.planEnabled("chatgpt.tokens.use.direct.evil")); }
    @Test public void interruptedStreamIsNotSuccess() { assertThrows(Exception.class, () -> SubscriptionOAuth.completedResponse(new StringReader("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\ndata: [DONE]\n\n"))); }
    @Test public void lateUsageFailurePreservesPreviousResult() { assertThrows(Exception.class, () -> SubscriptionOAuth.completedResponse(new StringReader("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\ndata: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}}\n\n"))); }
    @Test public void requiresCompletedStatus() { assertThrows(Exception.class, () -> SubscriptionOAuth.completedResponse(new StringReader("data: {\"type\":\"response.completed\",\"response\":{\"status\":\"incomplete\"}}\n\n"))); }
    @Test public void extractsOnlyCompletedStructuredText() throws Exception {
        JSONObject result = new JSONObject().put("summary", "Une synthèse vérifiée").put("cards", new JSONArray().put(new JSONObject().put("sourceId", "1").put("title", "Titre").put("summary", "Résumé")));
        JSONObject response = new JSONObject().put("status", "completed").put("output", new JSONArray().put(new JSONObject().put("content", new JSONArray().put(new JSONObject().put("type", "output_text").put("text", result.toString())))));
        assertEquals(result.toString(), SubscriptionOAuth.completedResponse(new StringReader("data: " + new JSONObject().put("type", "response.completed").put("response", response) + "\n\n")).toString());
    }
}
