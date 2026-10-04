import { Capacitor } from '@capacitor/core';
import { createMobileApi } from '../mobile/mobileApi';
import { capacitorNative } from '../mobile/native';

document.documentElement.dataset.platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
window.vault = createMobileApi(capacitorNative);
