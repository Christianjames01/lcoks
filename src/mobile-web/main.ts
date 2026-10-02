// Android entry: install the native-backed VaultApi BEFORE the UI modules load
// (ES module evaluation order guarantees ./install runs first).
import './install';
import '../renderer/main';
