export interface MyPluginSettings {
	apiBaseUrl: string;
	apiToken: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	apiBaseUrl: "https://wikidocs.net/napi",
	apiToken: "",
};
