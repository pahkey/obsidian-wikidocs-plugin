export interface WikiDocsPluginSettings {
	apiBaseUrl: string;
	apiToken: string;
}

export const DEFAULT_SETTINGS: WikiDocsPluginSettings = {
	apiBaseUrl: "https://wikidocs.net/napi",
	apiToken: "",
};
