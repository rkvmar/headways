import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'com.headways.app',
	appName: 'Headways',
	webDir: 'build',
	server: {
		hostname: 'localhost',
		iosScheme: 'capacitor',
		androidScheme: 'https'
	}
};

export default config;
