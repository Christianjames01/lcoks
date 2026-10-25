package com.vaultlocks.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import java.util.ArrayList;
import java.util.Locale;

/**
 * Kloud's ears and voice on Android.
 *
 * Listening prefers the phone's on-device speech model (nothing leaves the phone);
 * if there is none for the language, it falls back to the phone's normal speech
 * service (often Google's, which may use the internet). Speaking uses the phone's
 * text-to-speech. Must be used on the main thread.
 */
final class KloudVoice {
    interface Listener {
        void onLevel(float rmsDb);
        void onPartial(String text);
        void onResult(String text);
        void onError(String message);
    }

    /** Longest Kloud keeps listening in one go. */
    private static final long MAX_LISTEN_MS = 30_000;

    private SpeechRecognizer recognizer;
    private Listener listener;
    private Context context;
    private int attempt;
    // Phones end a recognition at the first short pause. Kloud keeps listening:
    // each piece is added here and a new recognition starts, until the user taps
    // Done, stays quiet (the phone's own no-speech timeout) or MAX_LISTEN_MS passes.
    private final StringBuilder heard = new StringBuilder();
    private boolean stopping;
    private long startedAt;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());

    static boolean available(Context c) {
        return SpeechRecognizer.isRecognitionAvailable(c) || onDevice(c);
    }

    static boolean onDevice(Context c) {
        return Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(c);
    }

    void start(Context c, Listener l) {
        context = c.getApplicationContext();
        listener = l;
        attempt = 0;
        heard.setLength(0);
        stopping = false;
        startedAt = System.currentTimeMillis();
        begin();
    }

    /** Try in order: on-device in the phone's language, on-device in English, the normal service. */
    private void begin() {
        destroy();
        boolean device = onDevice(context) && attempt < 2;
        if (!device && !SpeechRecognizer.isRecognitionAvailable(context)) {
            fail("Speech isn't available on this phone. Install Google's speech service or a voice pack.");
            return;
        }
        recognizer = device && Build.VERSION.SDK_INT >= 31 ? SpeechRecognizer.createOnDeviceSpeechRecognizer(context) : SpeechRecognizer.createSpeechRecognizer(context);
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, attempt == 1 ? "en-US" : Locale.getDefault().toLanguageTag());
        // Ask for longer pauses (many speech services ignore these; the restart below covers them).
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 3000L);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {
                if (listener != null) listener.onLevel(rmsdB);
            }
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onError(int error) {
                // No model for this language on the device: try the next way.
                boolean language = error == 12 /* ERROR_LANGUAGE_NOT_SUPPORTED */ || error == 13 /* ERROR_LANGUAGE_UNAVAILABLE */;
                boolean server = error == SpeechRecognizer.ERROR_SERVER || error == SpeechRecognizer.ERROR_CLIENT;
                if ((language || server) && attempt < 2 && heard.length() == 0) {
                    attempt++;
                    begin();
                    return;
                }
                // Quiet after speaking (or Done was tapped): that's the end.
                if (heard.length() > 0 || stopping) {
                    finish();
                    return;
                }
                fail(message(error));
            }
            @Override public void onResults(Bundle results) {
                ArrayList<String> r = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String text = r == null || r.isEmpty() ? "" : r.get(0).trim();
                if (!text.isEmpty()) {
                    if (heard.length() > 0) heard.append(' ');
                    heard.append(text);
                }
                if (listener == null) return;
                if (stopping || System.currentTimeMillis() - startedAt > MAX_LISTEN_MS) {
                    finish();
                    return;
                }
                // A pause, not the end: keep listening for the rest of the sentence.
                if (listener != null) listener.onPartial(heard.toString());
                main.post(() -> {
                    if (listener != null && !stopping) begin();
                    else finish();
                });
            }
            @Override public void onPartialResults(Bundle partial) {
                ArrayList<String> r = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (listener != null && r != null && !r.isEmpty()) listener.onPartial(heard.length() > 0 ? heard + " " + r.get(0) : r.get(0));
            }
            @Override public void onEvent(int eventType, Bundle params) {}
        });
        try {
            recognizer.startListening(i);
        } catch (Exception e) {
            fail("Couldn't start listening. Try again.");
        }
    }

    /** Deliver everything heard so far. */
    private void finish() {
        Listener l = listener;
        listener = null;
        destroy();
        String text = heard.toString().trim();
        heard.setLength(0);
        if (l == null) return;
        if (text.isEmpty()) l.onError("I didn't catch that. Try again.");
        else l.onResult(text);
    }

    private void fail(String msg) {
        Listener l = listener;
        destroy();
        listener = null;
        if (l != null) l.onError(msg);
    }

    private static String message(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "I didn't catch that. Try again.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "Allow the microphone for VaultLocks first.";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "No internet for speech. Download an offline voice pack in the phone's settings to use Kloud offline.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "The microphone is busy. Try again in a moment.";
            default:
                return "Something went wrong while listening. Try again.";
        }
    }

    /** Stop listening and use what was heard so far. */
    void stop() {
        stopping = true;
        if (recognizer != null) {
            try {
                recognizer.stopListening();
            } catch (Exception ignored) {
                finish();
            }
        } else {
            finish();
        }
    }

    void cancel() {
        listener = null;
        heard.setLength(0);
        main.removeCallbacksAndMessages(null);
        destroy();
    }

    private void destroy() {
        if (recognizer != null) {
            try {
                recognizer.cancel();
                recognizer.destroy();
            } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    // -------------------------------------------------------------- voice --

    private static TextToSpeech tts;
    private static boolean ttsReady;
    private static String pending;

    /** Say this out loud (replaces anything Kloud was still saying). */
    static void speak(Context c, String text) {
        if (text == null || text.trim().isEmpty()) return;
        if (tts == null) {
            pending = text;
            tts = new TextToSpeech(c.getApplicationContext(), status -> {
                ttsReady = status == TextToSpeech.SUCCESS;
                if (!ttsReady) return;
                int ok = tts.setLanguage(Locale.getDefault());
                if (ok == TextToSpeech.LANG_MISSING_DATA || ok == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(Locale.US);
                tts.setPitch(0.95f);
                if (pending != null) {
                    tts.speak(pending, TextToSpeech.QUEUE_FLUSH, null, "kloud");
                    pending = null;
                }
            });
            return;
        }
        if (ttsReady) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "kloud");
        else pending = text;
    }

    static void hush() {
        pending = null;
        if (tts != null && ttsReady) tts.stop();
    }
}
