import { createMobileApi } from '../mobile/mobileApi';
import { capacitorNative } from '../mobile/native';

document.documentElement.dataset.platform = 'android';
window.vault = createMobileApi(capacitorNative);
