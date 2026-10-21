package com.vaultlocks.app;

/**
 * Recognises exactly TWO deliberate taps on the back of the phone from raw
 * accelerometer samples. Deliberately strict, so that walking, typing, putting the
 * phone down, a bump in a pocket or a single tap never counts:
 *
 *   1. the phone was still just before the first tap;
 *   2. each tap is a short, sharp knock mostly along Z (through the phone), not sideways;
 *   3. the second knock comes 140–500 ms after the first, in the same direction and of
 *      similar strength;
 *   4. nothing else happens for 250 ms afterwards (a third knock or shaking cancels).
 *
 * Plain Java (no Android APIs) so it can be tested on a desktop JVM.
 */
final class TapDetector {
    private static final long MIN_GAP_MS = 140;
    private static final long MAX_GAP_MS = 500;
    private static final long CONFIRM_MS = 250;
    private static final long RING_MS = 80; // one knock "rings" for a few samples
    private static final float MAX_KNOCK = 25f; // above this it is a drop or a hard bump

    private final float threshold;
    private final float[] gravity = new float[3];
    private boolean primed = false;
    private long lastT = 0;
    /** Background movement (walking, shaking), m/s². */
    private float energy = 0;

    private long firstAt = 0;
    private int firstSign = 0;
    private float firstMag = 0;
    private long secondAt = 0;
    private long lastPeak = -1000;
    private long cooldownUntil = 0;

    /** threshold: minimum knock strength in m/s² (higher = firmer taps needed). */
    TapDetector(float threshold) {
        this.threshold = threshold;
    }

    void reset() {
        primed = false;
        energy = 0;
        firstAt = 0;
        secondAt = 0;
    }

    /** Feed one sample (time in ms). Returns true once, when a double tap is confirmed. */
    boolean feed(long t, float ax, float ay, float az) {
        if (!primed) {
            gravity[0] = ax;
            gravity[1] = ay;
            gravity[2] = az;
            primed = true;
            lastT = t;
            return false;
        }
        float dt = Math.max(1, Math.min(100, t - lastT)) / 1000f;
        lastT = t;
        // Gravity: slow low-pass (time constant 0.15 s) whatever the sensor rate.
        float a = 0.15f / (0.15f + dt);
        gravity[0] = a * gravity[0] + (1 - a) * ax;
        gravity[1] = a * gravity[1] + (1 - a) * ay;
        gravity[2] = a * gravity[2] + (1 - a) * az;
        float x = ax - gravity[0];
        float y = ay - gravity[1];
        float z = az - gravity[2];
        float side = (float) Math.sqrt(x * x + y * y);
        float mag = Math.abs(z);

        boolean quietBefore = energy < threshold * 0.3f;
        // Background movement, time constant 0.25 s.
        float b = dt / (0.25f + dt);
        energy = (1 - b) * energy + b * (mag + side);

        if (t < cooldownUntil) return false;

        // Confirm: second knock happened and nothing followed.
        if (secondAt != 0 && t - secondAt >= CONFIRM_MS) {
            secondAt = 0;
            firstAt = 0;
            cooldownUntil = t + 1500;
            return true;
        }

        boolean knock = mag > threshold && mag > side * 2f && mag < MAX_KNOCK && t - lastPeak > RING_MS;
        if (knock) {
            lastPeak = t;
            int sign = z > 0 ? 1 : -1;
            if (secondAt != 0) {
                // A third knock: not a double tap (drumming, shaking, a bump).
                secondAt = 0;
                firstAt = 0;
                cooldownUntil = t + 600;
                return false;
            }
            if (firstAt == 0) {
                if (quietBefore) {
                    firstAt = t;
                    firstSign = sign;
                    firstMag = mag;
                }
                return false;
            }
            long gap = t - firstAt;
            float ratio = mag / firstMag;
            if (gap >= MIN_GAP_MS && gap <= MAX_GAP_MS && sign == firstSign && ratio > 0.4f && ratio < 2.5f) {
                secondAt = t;
            } else {
                firstAt = 0; // wrong rhythm / direction / strength: start over
            }
            return false;
        }

        // Waiting for the second knock: give up after the window, or if the phone starts moving.
        if (firstAt != 0 && secondAt == 0 && (t - firstAt > MAX_GAP_MS || energy > threshold * 0.8f)) firstAt = 0;
        if (secondAt != 0 && energy > threshold * 0.8f) {
            secondAt = 0;
            firstAt = 0;
        }
        return false;
    }
}
