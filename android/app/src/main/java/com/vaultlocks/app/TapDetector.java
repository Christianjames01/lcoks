package com.vaultlocks.app;

/**
 * Recognises a deliberate double tap on the back of the phone from raw
 * accelerometer samples.
 *
 *   1. the phone was reasonably still just before the first tap;
 *   2. each tap is a short, sharp knock mostly along Z (through the phone). Its
 *      direction and strength come from the biggest sample of the knock, not the first;
 *   3. the second knock comes 100–480 ms after the first, in the same direction and
 *      of similar strength;
 *   4. it fires shortly after the second knock. Extra taps (people often tap 3–4 times
 *      when unsure) don't cancel it — they fall into the cooldown afterwards.
 *
 * Walking, typing, putting the phone down or shaking still never count (motion
 * before the tap, wrong rhythm, opposite directions or very different strengths).
 *
 * Plain Java (no Android APIs) so it can be tested on a desktop JVM.
 */
final class TapDetector {
    private static final long MIN_GAP_MS = 100;
    private static final long MAX_GAP_MS = 480; // footsteps are ~450–650 ms apart
    private static final long CONFIRM_MS = 120;
    private static final long PEAK_WINDOW_MS = 40; // a knock rings; take its biggest sample
    private static final long RING_MS = 70;
    private static final float MAX_KNOCK = 30f; // above this it is a drop or a hard bump

    private final float threshold;
    private final float[] gravity = new float[3];
    private boolean primed = false;
    private long lastT = 0;
    /** Background movement (walking, shaking), m/s². */
    private float energy = 0;

    // Knock being measured.
    private long peakStart = 0;
    private float peakZ = 0;
    private float peakSide = 0;
    private boolean peakQuiet = false;

    private long firstAt = 0;
    private int firstSign = 0;
    private float firstMag = 0;
    private long secondAt = 0;
    private long lastKnockEnd = -1000;
    private long cooldownUntil = 0;

    /** threshold: minimum knock strength in m/s² (higher = firmer taps needed). */
    TapDetector(float threshold) {
        this.threshold = threshold;
    }

    void reset() {
        primed = false;
        energy = 0;
        peakStart = 0;
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
            // Let the gravity filter settle (screen just turned on, phone maybe moving).
            cooldownUntil = t + 400;
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

        boolean quiet = energy < threshold * 0.45f;
        // Background movement, time constant 0.3 s. Knock samples count only a little
        // (they are short), so tapping several times doesn't make the phone look "moving".
        float b = dt / (0.3f + dt);
        energy = (1 - b) * energy + b * Math.min(mag + side, threshold * 0.6f + 0.25f * (mag + side));

        // Confirm a double tap shortly after its second knock.
        if (secondAt != 0 && t - secondAt >= CONFIRM_MS) {
            secondAt = 0;
            firstAt = 0;
            cooldownUntil = t + 1200;
            return true;
        }
        if (t < cooldownUntil) return false;

        // Measuring a knock: keep its strongest sample for PEAK_WINDOW_MS.
        if (peakStart != 0) {
            if (mag > Math.abs(peakZ)) {
                peakZ = z;
                peakSide = side;
            }
            if (t - peakStart < PEAK_WINDOW_MS) return false;
            long at = peakStart;
            peakStart = 0;
            lastKnockEnd = t;
            float pm = Math.abs(peakZ);
            if (pm >= MAX_KNOCK || pm < peakSide * 1.4f) return false; // a bump, not a tap
            onKnock(at, peakZ > 0 ? 1 : -1, pm, peakQuiet);
            return false;
        }

        if (mag > threshold && t - lastKnockEnd > RING_MS - PEAK_WINDOW_MS) {
            peakStart = t;
            peakZ = z;
            peakSide = side;
            peakQuiet = quiet;
            return false;
        }

        // Waiting for the second knock: give up after the window, or if the phone is moving.
        if (firstAt != 0 && secondAt == 0 && (t - firstAt > MAX_GAP_MS + PEAK_WINDOW_MS || energy > threshold * 0.75f)) firstAt = 0;
        return false;
    }

    private void onKnock(long at, int sign, float mag, boolean quietBefore) {
        if (secondAt != 0) return; // already have two: extra taps just wait for the confirmation
        if (firstAt != 0) {
            long gap = at - firstAt;
            float ratio = mag / firstMag;
            if (gap >= MIN_GAP_MS && gap <= MAX_GAP_MS && sign == firstSign && ratio > 0.33f && ratio < 3f) {
                secondAt = at;
                return;
            }
            if (gap < MIN_GAP_MS) return; // same knock ringing on
        }
        // Start a new attempt (this knock may be the first of the next pair).
        firstAt = quietBefore ? at : 0;
        firstSign = sign;
        firstMag = mag;
    }
}
