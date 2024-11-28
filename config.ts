export interface MyPluginSettings {
	apiBaseUrl: string;
	apiToken: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	apiBaseUrl: "http://127.0.0.1:8000/napi",
	apiToken: "",
};
