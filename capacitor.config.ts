import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'com.transbay.headways.app',
	appName: 'Headways',
	webDir: 'build',
	server: {
		hostname: 'localhost',
		iosScheme: 'capacitor',
		androidScheme: 'https'
	}
};

export default config;
