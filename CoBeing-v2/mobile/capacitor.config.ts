import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.cobeing.mobile',
  appName: 'CoBeing',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
}

export default config
