// Runs after `npm install` / `npm ci` (package.json "postinstall").
//
// @capacitor/local-notifications marks every notification VISIBILITY_PRIVATE, so a
// locked Android phone only shows "Contents hidden" for VaultLocks reminders, whatever
// the channel says. VaultLocks' reminder text is already safe for the lock screen (it
// names the event only when the user turned on "Show event titles"), so the
// notification follows the channel instead: public.
import fs from 'node:fs';
import path from 'node:path';

const file = path.join('node_modules', '@capacitor', 'local-notifications', 'android', 'src', 'main', 'kotlin', 'com', 'capacitorjs', 'plugins', 'localnotifications', 'LocalNotificationManager.kt');
const FROM = 'mBuilder.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)';
const TO = 'mBuilder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC) // patched by VaultLocks (scripts/patch-plugins.mjs)';

if (!fs.existsSync(file)) {
  console.log('patch-plugins: local-notifications not installed, skipped');
} else {
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(TO)) console.log('patch-plugins: already patched');
  else if (src.includes(FROM)) {
    fs.writeFileSync(file, src.replace(FROM, TO));
    console.log('patch-plugins: reminders now show on the lock screen');
  } else {
    // Plugin changed upstream: fail loudly so the build is checked instead of silently private.
    console.error('patch-plugins: expected line not found in LocalNotificationManager.kt — check the lock-screen visibility patch');
    process.exit(1);
  }
}
