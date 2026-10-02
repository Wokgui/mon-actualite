package com.wokgui.monactualite;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import static org.junit.Assert.*;

public class SubscriptionConnectionTest {
    @Test public void immediateSuccessHasNoDelay() throws Exception {
        List<Long> delays = new ArrayList<>();
        assertEquals("ok", SubscriptionConnection.resolveBeforeSend(() -> "ok", () -> null, delays::add));
        assertTrue(delays.isEmpty());
    }
    @Test public void recoversDnsBeforeSingleBodySend() throws Exception {
        AtomicInteger sockets = new AtomicInteger(), bodies = new AtomicInteger(), readiness = new AtomicInteger();
        List<Long> delays = new ArrayList<>();
        String socket = SubscriptionConnection.resolveBeforeSend(() -> {
            if (sockets.incrementAndGet() < 3) throw new UnknownHostException("test");
            return "connected";
        }, () -> { readiness.incrementAndGet(); return null; }, delays::add);
        // Body sending is deliberately outside the retried operation, as in the Android adapter.
        bodies.incrementAndGet();
        assertEquals("connected", socket); assertEquals(3, sockets.get()); assertEquals(3, readiness.get());
        assertEquals(1, bodies.get()); assertEquals(Arrays.asList(1000L, 2000L), delays);
    }
    @Test public void persistentDnsIsBounded() {
        AtomicInteger attempts = new AtomicInteger(); List<Long> delays = new ArrayList<>();
        assertThrows(UnknownHostException.class, () -> SubscriptionConnection.resolveBeforeSend(() -> {
            attempts.incrementAndGet(); throw new UnknownHostException("test");
        }, () -> null, delays::add));
        assertEquals(3, attempts.get()); assertEquals(Arrays.asList(1000L, 2000L), delays);
    }
    @Test public void ambiguousTimeoutIsNeverRetried() {
        AtomicInteger attempts = new AtomicInteger();
        assertThrows(SocketTimeoutException.class, () -> SubscriptionConnection.resolveBeforeSend(() -> {
            attempts.incrementAndGet(); throw new SocketTimeoutException("ambiguous");
        }, () -> null, delay -> fail("no retry")));
        assertEquals(1, attempts.get());
    }
    @Test public void otherIoErrorsAreNeverRetried() {
        assertThrows(IOException.class, () -> SubscriptionConnection.resolveBeforeSend(() -> {
            throw new IOException("connection interrupted");
        }, () -> null, delay -> fail("no retry")));
    }
    @Test public void cancellationBetweenRetriesPreventsSending() {
        AtomicInteger checks = new AtomicInteger(), attempts = new AtomicInteger();
        assertThrows(Exception.class, () -> SubscriptionConnection.resolveBeforeSend(() -> {
            attempts.incrementAndGet(); throw new UnknownHostException("test");
        }, () -> { if (checks.incrementAndGet() > 1) throw new Exception("cancelled"); return null; }, delay -> {}));
        assertEquals(1, attempts.get());
    }
    @Test public void interruptionDuringBackoffStopsRecovery() {
        AtomicInteger attempts = new AtomicInteger();
        assertThrows(InterruptedException.class, () -> SubscriptionConnection.resolveBeforeSend(() -> {
            attempts.incrementAndGet(); throw new UnknownHostException("test");
        }, () -> null, delay -> { throw new InterruptedException(); }));
        assertEquals(1, attempts.get());
    }
    @Test public void browserForegroundBlocksNetworkUntilAppResumes() throws Exception {
        SubscriptionConnection.Foreground gate = new SubscriptionConnection.Foreground();
        CountDownLatch started = new CountDownLatch(1), done = new CountDownLatch(1);
        AtomicReference<Exception> failure = new AtomicReference<>(); AtomicInteger attempts = new AtomicInteger();
        Thread worker = new Thread(() -> {
            started.countDown();
            try { SubscriptionConnection.resolveBeforeSend(() -> { attempts.incrementAndGet(); return "ok"; }, () -> { gate.await(() -> true, 3000); return null; }, delay -> {}); }
            catch (Exception error) { failure.set(error); }
            finally { done.countDown(); }
        });
        worker.start();
        try {
            assertTrue(started.await(1, TimeUnit.SECONDS));
            assertFalse(done.await(100, TimeUnit.MILLISECONDS)); assertEquals(0, attempts.get());
            gate.setResumed(true);
            assertTrue(done.await(2, TimeUnit.SECONDS)); assertNull(failure.get()); assertEquals(1, attempts.get());
        } finally { gate.close(); worker.join(1000); }
    }
    @Test public void pauseAfterResumeBlocksNextRequest() throws Exception {
        SubscriptionConnection.Foreground gate = new SubscriptionConnection.Foreground();
        gate.setResumed(true); gate.await(() -> true, 0);
        gate.setResumed(false); assertThrows(Exception.class, () -> gate.await(() -> true, 0));
    }
    @Test public void cancelledSessionCannotResumeEvenWhenForeground() {
        SubscriptionConnection.Foreground gate = new SubscriptionConnection.Foreground(); gate.setResumed(true);
        assertThrows(Exception.class, () -> gate.await(() -> false, 100));
    }
    @Test public void destroyingGateWakesPendingRequest() throws Exception {
        SubscriptionConnection.Foreground gate = new SubscriptionConnection.Foreground(); CountDownLatch done = new CountDownLatch(1);
        AtomicBoolean refused = new AtomicBoolean();
        Thread worker = new Thread(() -> { try { gate.await(() -> true, 3000); } catch (Exception error) { refused.set(true); } finally { done.countDown(); } });
        worker.start(); gate.close();
        assertTrue(done.await(1, TimeUnit.SECONDS)); assertTrue(refused.get()); worker.join(1000);
    }
}
