package com.vaultlocks.app;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What Kloud answers on the lock screen, before the vault is unlocked. It only
 * repeats what was said (amount, account, what for); the sentence itself is
 * stored encrypted and understood fully by the app on unlock (src/shared/kloud.ts).
 */
final class KloudSay {
    static final class Reply {
        /** Shown on screen. */
        final String text;
        /** Spoken ("150 pesos" instead of "₱150"). */
        final String spoken;
        /** True when the sentence should be saved. */
        final boolean save;

        Reply(String text, String spoken, boolean save) {
            this.text = text;
            this.spoken = spoken;
            this.save = save;
        }
    }

    private static final Pattern WAKE = Pattern.compile("^\\s*(?:hey\\s+|ok(?:ay)?\\s+|hi\\s+)?(?:kloud|cloud|claude|clod)[\\s,]*", Pattern.CASE_INSENSITIVE);
    private static final Pattern TASK = Pattern.compile("^(?:please\\s+)?(?:remind me(?: to)?|set a reminder(?: to)?|add (?:a )?(?:task|to ?do|reminder)(?: to)?|new task|create (?:a )?task|task|to ?do|don'?t forget(?: to)?|paalala)\\s+(.+)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern AMOUNT = Pattern.compile("(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?\\s?(k\\b)?", Pattern.CASE_INSENSITIVE);
    private static final Pattern INCOME = Pattern.compile("^\\+|\\b(salary|sweldo|sahod|income|bonus|allowance|baon|received|refund|cashback|sold|cash ?in|top ?up|deposit)\\b", Pattern.CASE_INSENSITIVE);

    private KloudSay() {}

    static Reply reply(String said, JSONObject meta) {
        String t = WAKE.matcher(said == null ? "" : said.trim()).replaceFirst("").trim();
        if (t.isEmpty()) return new Reply("I didn't catch that.", "I didn't catch that.", false);

        Matcher task = TASK.matcher(t);
        if (task.find()) {
            String what = task.group(1).trim();
            String msg = "Okay. I'll remind you: " + what + ". It's set as soon as you unlock VaultLocks.";
            return new Reply(msg, msg, true);
        }

        Matcher m = AMOUNT.matcher(t);
        if (!m.find()) {
            String msg = "While the phone is locked I can add expenses and reminders, like “lunch 150” or “remind me to call Mama at 7”.";
            return new Reply(msg, msg, false);
        }
        String num = m.group(1).replace(",", "");
        double value = Double.parseDouble(num + (m.group(2) != null ? "." + m.group(2) : ""));
        if (m.group(3) != null) value *= 1000;
        boolean income = INCOME.matcher(t).find();

        String account = null;
        JSONArray list = meta == null ? null : meta.optJSONArray("accounts");
        String lower = " " + t.toLowerCase(Locale.ROOT) + " ";
        if (list != null) {
            for (int i = 0; i < list.length(); i++) {
                JSONObject a = list.optJSONObject(i);
                String name = a == null ? "" : a.optString("name", "");
                if (!name.isEmpty() && lower.matches(".*[^a-z0-9]" + Pattern.quote(name.toLowerCase(Locale.ROOT)) + "[^a-z0-9].*")) {
                    account = name;
                    break;
                }
            }
        }
        // What it was for: the words left over.
        String what = (t.substring(0, m.start()) + " " + t.substring(m.end()))
            .replaceAll("(?i)\\b(i spent|spent|i paid|paid|add|log|pesos?|php|from|using|with|via|sa|on|for|cash ?in|top ?up)\\b", " ");
        if (account != null) what = what.replaceAll("(?i)\\b" + Pattern.quote(account) + "\\b", " ");
        what = what.replaceAll("[₱$]", " ").replaceAll("\\s+", " ").trim();

        String currency = meta == null ? "PHP" : meta.optString("currency", "PHP");
        String amountText = (value % 1 == 0 ? String.format(Locale.US, "%,d", (long) value) : String.format(Locale.US, "%,.2f", value));
        String sign = "PHP".equals(currency) ? "₱" : "USD".equals(currency) ? "$" : currency + " ";
        String unit = "PHP".equals(currency) ? " pesos" : "USD".equals(currency) ? " dollars" : " " + currency;

        String shown;
        String spoken;
        if (income) {
            shown = "Done. Added " + sign + amountText + (account != null ? " to " + account : "") + ".";
            spoken = "Done. Added " + amountText + unit + (account != null ? " to " + account : "") + ".";
        } else {
            String forWhat = what.isEmpty() ? "" : " for " + what;
            shown = "Done. " + sign + amountText + forWhat + (account != null ? " from " + account : "") + ".";
            spoken = "Done. " + amountText + unit + forWhat + (account != null ? " from " + account : "") + ".";
        }
        return new Reply(shown, spoken, true);
    }
}
