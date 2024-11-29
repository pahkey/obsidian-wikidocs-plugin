import { PageMetadata, saveBookMetadata, savePagesToMarkdown } from "lib/md";
import { ensureFolderExists, sanitizeFileName } from "lib/utils";
import { App, Notice, TFile } from "obsidian";
import { MyPluginSettings } from "./config";

export class ApiClient {
	private settings: MyPluginSettings;

	constructor(settings: MyPluginSettings) {
		this.settings = settings;
	}

	async fetchWithAuth(endpoint: string, options: RequestInit = {}): Promise<Response> {
		const token = this.settings.apiToken;
	
		if (!token) {
			throw new Error("API token is not set. Please configure the plugin.");
		}
	
		const baseUrl = this.settings.apiBaseUrl.replace(/\/+$/, ""); // 끝 슬래시 제거
		const sanitizedEndpoint = endpoint.replace(/^\/+/, ""); // 시작 슬래시 제거
	
		const url = `${baseUrl}/${sanitizedEndpoint}`;
		const headers = {
			...options.headers,
			Authorization: `Token ${token}`,
		};
	
		return fetch(url, {
			...options,
			headers,
		});
	}

    async updatePageOnServer(metadata: PageMetadata, content: string): Promise<number> {
		// 요청 데이터 구성
		const data = {
			id: metadata.id, // 페이지 ID
			book_id: metadata.book_id,
            parent_id: metadata.parent_id,
			subject: metadata.subject, // 제목 (필수 항목)
			content: content.trim(), // 내용 (필수 항목)
			open_yn: metadata.open_yn,
		};
	
		// 요청 전송
		const response = await this.fetchWithAuth(`/pages/${metadata.id}/`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(data),
		});
	
		// 결과 처리
		if (response.ok) {
            const data = await response.json();
            return data.id;
		} else {
			const errorText = await response.text();
			console.error(`Failed to update page ${metadata.id}: ${errorText}`);
            return -1;
		}
	}

    /**
	 * Upload images to the server for the given page ID.
	 */
	async uploadImagesForPage(app: App, pageId: number, imageFiles: TFile[]): Promise<Record<string, string>> {
		const imageMap: Record<string, string> = {};
	
		for (const file of imageFiles) {
			const arrayBuffer = await app.vault.readBinary(file);
			const formData = new FormData();
			formData.append("file", new Blob([arrayBuffer]), file.name);
			formData.append("page_id", pageId.toString());
	
			const response = await this.fetchWithAuth(`/images/upload/`, {
				method: "POST",
				body: formData,
			});
	
			if (!response.ok) {
				throw new Error(`Failed to upload image: ${file.name}`);
			}
	
			const data = await response.json();
			imageMap[file.path] = data.url; // 서버에서 받은 URL 매핑
		}
	
		return imageMap;
	}

	async downloadBook(app:App, bookId: number) {
		const response = await this.fetchWithAuth(`/books/${bookId}/`);
		if (!response.ok) {
			new Notice("책 내려받기가 실패했습니다.");
			return;
		}

		const bookData = await response.json();
		const folderPath = sanitizeFileName(bookData.subject);

		await ensureFolderExists(folderPath);
		await saveBookMetadata(folderPath, bookId, bookData.subject);
		await savePagesToMarkdown(app, bookData.pages, folderPath);

		new Notice(`"${bookData.subject}" 책을 성공적으로 내려받았습니다!`);
	}
}
