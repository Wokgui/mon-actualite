package com.wokgui.monactualite;

import java.net.UnknownHostException;
import java.util.function.BooleanSupplier;

/** Lifecycle gate and pre-send DNS recovery, independent of Android for regression tests. */
final class SubscriptionConnection {
    interface Call<T> { T run() throws Exception; }
    interface Pause { void sleep(long milliseconds) throws InterruptedException; }

    static <T> T resolveBeforeSend(Call<T> call, Call<Void> readiness, Pause pause) throws Exception {
        for (int attempt = 0; ; attempt++) {
            readiness.run();
            try { return call.run(); }
            catch (UnknownHostException error) {
                if (attempt == 2) throw error;
                pause.sleep((attempt + 1) * 1000L);
            }
        }
    }

    static final class Foreground {
        private boolean resumed, closed;
        synchronized void setResumed(boolean value) { resumed = value; notifyAll(); }
        synchronized void signal() { notifyAll(); }
        synchronized void close() { closed = true; notifyAll(); }
        synchronized void await(BooleanSupplier current, long timeoutMs) throws Exception {
            long deadline = System.nanoTime() + timeoutMs * 1000000L;
            while (true) {
                if (closed || !current.getAsBoolean() || Thread.currentThread().isInterrupted()) throw new Exception("Connexion annulée.");
                if (resumed) return;
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) throw new Exception("Reviens dans Mon Actualité pour terminer la connexion, puis réessaie.");
                wait(Math.max(1, Math.min(remaining / 1000000L, 250)));
            }
        }
    }
}
