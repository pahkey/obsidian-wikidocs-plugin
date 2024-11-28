import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from "obsidian";

import {
	deleteFolderContents,
	ensureFolderExists,
	ensureLineBreaks,
	extractEmbeddedImages,
	extractTitleFromFilePath,
	getFileModifiedTime,
	removeFrontMatter,
	sanitizeFileName,
} from "./utils";

import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
} from "./config";

import {
	ApiClient,
} from "./api";

import {
	addFrontMatterToFile,
	extractMetadataFromFrontMatter,
	getBookIdFromMetadata,
	saveBookMetadata,
	savePagesToMarkdown,
} from "./md";

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	apiClient: ApiClient;
	

	async onload() {
		await this.loadSettings();
		this.apiClient = new ApiClient(this.settings);

		// 책 리스트에서 선택하여 가져오기
		this.addCommand({
			id: "fetch-selected-book",
			name: "위키독스 책 목록 가져오기",
			callback: async () => {
				const bookId = await this.promptForBookSelection();
				if (bookId) {
					// 책 정보를 가져와 제목을 최상위 폴더로 설정
					const response = await this.apiClient.fetchWithAuth(`/books/${bookId}/`);
					if (!response.ok) {
						new Notice("Failed to fetch the selected book.");
						return;
					}
		
					const bookData = await response.json();
					const folderPath = sanitizeFileName(bookData.subject); // 책 제목을 폴더로 사용
		
					await ensureFolderExists(folderPath);

					// 책 ID와 제목을 metadata.md 파일에 저장
					await saveBookMetadata(folderPath, bookId, bookData.subject);

					await savePagesToMarkdown(bookData.pages, folderPath);
		
					new Notice(`Book "${bookData.subject}" fetched successfully!`);
				}
			},
		});
		

		// 컨텍스트 메뉴에 항목 추가
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFolder) {
					// 위키독스로부터 내려받기
					menu.addItem((item) => {
						item.setTitle("위키독스로부터 내려받기")
							.setIcon("cloud-download")
							.onClick(async () => {
								await this.syncFromServer(file);
							});
					});
		
					// 위키독스로 보내기
					menu.addItem((item) => {
						item.setTitle("위키독스로 보내기")
							.setIcon("cloud-upload")
							.onClick(async () => {
								await this.syncToServer(file);
							});
					});
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("create", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					const content = await this.app.vault.read(file);
		
					if (content.trim() === "") {
						await addFrontMatterToFile(file); // Front Matter 추가
					} else {
					}
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					addFrontMatterToFile(file);
				}
			})
		);

		// 설정 탭 추가
		this.addSettingTab(new MyPluginSettingTab(this.app, this));
	}

	async onunload() {
	}
	
	async syncFromServer(folder: TFolder) {
		const folderName = folder.name;
	
		try {
			// Step 1: 책 폴더와 페이지 삭제 (동기적 흐름)
			await deleteFolderContents(folder);

			// 최상위 폴더 삭제 상태 확인 (필요 시)
			// await this.waitForFolderDeletion(folder.path);
	
			// Step 2: 서버에서 책 데이터 가져오기
			const bookId = await getBookIdFromMetadata(folder.path);
			if (!bookId) {
				new Notice(`No book ID found in metadata for folder "${folderName}".`);
				return;
			}
	
			const bookResponse = await this.apiClient.fetchWithAuth(`/books/${bookId}/`);
			if (!bookResponse.ok) {
				new Notice("Failed to fetch the selected book from server.");
				return;
			}
	
			const bookData = await bookResponse.json();
	
			// Step 3: 책 데이터를 새로 저장
			await savePagesToMarkdown(bookData.pages, folder.path);
	
			new Notice(`Book "${bookData.subject}" synced successfully!`);
		} catch (error) {
			console.error(`Failed to sync folder "${folderName}"`, error);
			new Notice(`Failed to sync folder "${folderName}".`);
		}
	}	
	
	async syncToServer(folder: TFolder) {
		const folderName = folder.name;
		const files = this.app.vault.getFiles().filter((file) => file.path.startsWith(folder.path));
	
		let changedCount = 0;
	
		for (const file of files) {
			try {
				if (file.name === "metadata.md") {
					// metadata.md 파일은 업로드하지 않음
					continue;
				}
	
				const fileContent = await this.app.vault.read(file);
				const metadata = await extractMetadataFromFrontMatter(file);
	
				if (!metadata.id) {
					console.error(`No ID found in Front Matter for file: ${file.path}`);
					continue;
				}
	
				// parent_id가 null이거나 "null"인 경우 -1로 설정
				if (
					metadata.parent_id === null ||
					(typeof metadata.parent_id === "string" && metadata.parent_id === "null")
				) {
					metadata.parent_id = -1;
				}
	
				// 동기화 시점 확인
				const lastSynced = metadata.last_synced ? new Date(metadata.last_synced) : null;
				const fileModifiedAt = getFileModifiedTime(file);
	
				const needsSync =
					!lastSynced || 
					fileModifiedAt.getTime() - lastSynced.getTime() > 1000 || // 수정 시간 비교
					sanitizeFileName(metadata.subject) !== sanitizeFileName(extractTitleFromFilePath(file.path)); // 제목 변경 감지
	
				if (needsSync) {
					console.log(`File "${file.path}" needs to be synced.`);
					changedCount++;
	
					const contentWithoutFrontMatter = ensureLineBreaks(removeFrontMatter(fileContent));
	
					// 이미지 파일 처리
					const embeddedImages = extractEmbeddedImages(contentWithoutFrontMatter);
					if (metadata.id != -1) { // 신규 파일이 아닌 경우에만 이미지 업로드
						await this.apiClient.uploadImagesForPage(this.app, metadata.id, embeddedImages);
					}
	
					// 이미지 URL 업데이트
					let updatedContent = contentWithoutFrontMatter;
					// for (const [localPath, uploadedUrl] of Object.entries(uploadedImages)) {
					// 	updatedContent = updatedContent.replace(localPath, uploadedUrl);
					// }
	
					// 서버에 업데이트
					const page_id = await this.apiClient.updatePageOnServer(metadata.id, updatedContent, {
						subject: extractTitleFromFilePath(file.path),
						book_id: metadata.book_id,
						parent_id: metadata.parent_id,
					});

					// const updatedFrontMatter = updateLastSyncedFrontMatter(fileContent);
					// await this.app.vault.modify(file, updatedFrontMatter);

					if (metadata.id == -1) { // 신규 파일인 경우에 이미지 업로드후 저장 한번 더!!
						await this.apiClient.uploadImagesForPage(this.app, page_id, embeddedImages);
						await this.apiClient.updatePageOnServer(page_id, updatedContent, {
							subject: extractTitleFromFilePath(file.path),
							book_id: metadata.book_id,
							parent_id: metadata.parent_id,
						});
					}
				}
			} catch (error) {
				console.error(`Failed to sync file to server: ${file.path}`, error);
			}
		}
	
		if (changedCount > 0) {
			await this.syncFromServer(folder);
		}
	
		new Notice(`Folder "${folderName}" synced to server successfully!`);
	}
	

	async promptForBookSelection(): Promise<number | null> {
		const response = await this.apiClient.fetchWithAuth(`/books/`);
		if (!response.ok) {
			new Notice("Failed to fetch book list.");
			return null;
		}
		const books = await response.json();
	
		return new Promise((resolve) => {
			const modal = new Modal(this.app);
	
			modal.onClose = () => resolve(null);
	
			modal.contentEl.createEl("h2", { text: "Select a Book" });
			const list = modal.contentEl.createEl("ul");
	
			books.forEach((book: { id: number; subject: string }) => {
				const listItem = list.createEl("li", {
					text: book.subject,
				});
	
				listItem.onclick = () => {
					resolve(book.id);
					modal.close();
				};
			});
	
			modal.open();
		});
	}

	// 설정 저장
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class MyPluginSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "플러그인 설정" });

		new Setting(containerEl)
			.setName("API Base URL")
			.setDesc("API의 기본 URL을 설정합니다.")
			.addText((text) =>
				text
					.setPlaceholder("http://127.0.0.1:8000/napi")
					.setValue(this.plugin.settings.apiBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiBaseUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("API Token")
			.setDesc("API 인증 토큰을 입력합니다.")
			.addText((text) =>
				text
					.setPlaceholder("토큰 입력")
					.setValue(this.plugin.settings.apiToken)
					.onChange(async (value) => {
						this.plugin.settings.apiToken = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
