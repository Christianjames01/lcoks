package com.vaultlocks.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * "Scan with camera": reads the text in a photo with ML Kit's bundled model.
 * Runs on the phone (no network needed); the photo stays in memory and is
 * dropped as soon as the text is read. The app (src/shared/scan.ts) turns the
 * lines into form fields.
 */
final class TextScan {
    interface Done {
        void lines(List<String> lines);
        void error(String message);
    }

    private TextScan() {}

    static void read(String jpegB64, Done done) {
        Bitmap bitmap;
        try {
            byte[] bytes = Base64.decode(jpegB64, Base64.DEFAULT);
            bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) {
            done.error("Could not read the photo.");
            return;
        }
        if (bitmap == null) {
            done.error("Could not read the photo.");
            return;
        }
        final Bitmap image = bitmap;
        final TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        recognizer
            .process(InputImage.fromBitmap(image, 0))
            .addOnSuccessListener(text -> {
                done.lines(linesOf(text));
                recognizer.close();
                image.recycle();
            })
            .addOnFailureListener(e -> {
                done.error("Could not read text in the photo.");
                recognizer.close();
                image.recycle();
            });
    }

    /** All lines, top to bottom (then left to right). */
    private static List<String> linesOf(Text text) {
        List<Text.Line> all = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) all.addAll(block.getLines());
        Collections.sort(all, (a, b) -> {
            int ay = a.getBoundingBox() == null ? 0 : a.getBoundingBox().centerY();
            int by = b.getBoundingBox() == null ? 0 : b.getBoundingBox().centerY();
            int ah = a.getBoundingBox() == null ? 1 : Math.max(1, a.getBoundingBox().height());
            if (Math.abs(ay - by) > ah / 2) return Integer.compare(ay, by);
            int ax = a.getBoundingBox() == null ? 0 : a.getBoundingBox().left;
            int bx = b.getBoundingBox() == null ? 0 : b.getBoundingBox().left;
            return Integer.compare(ax, bx);
        });
        List<String> out = new ArrayList<>();
        for (Text.Line l : all) out.add(l.getText());
        return out;
    }
}
