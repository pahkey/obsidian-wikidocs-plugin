import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from "obsidian";

import {
	deleteFolderContents,
	extractEmbeddedImages,
	extractTitleFromFilePath,
	getFileModifiedTime,
	removeFrontMatter,
	sanitizeFileName,
	showConfirmationDialog
} from "./lib/utils";

import {
	DEFAULT_SETTINGS,
	WikiDocsPluginSettings,
} from "./lib/config";

import {
	ApiClient,
} from "./lib/api";

import {
	addFrontMatterToFile,
	extractMetadataFromFrontMatter,
	getBookIdFromMetadata,
	savePagesToMarkdown
} from "./lib/md";

export default class WikiDocsPlugin extends Plugin {
	settings: WikiDocsPluginSettings;
	apiClient: ApiClient;
	

	async onload() {
		await this.loadSettings();
		this.apiClient = new ApiClient(this.settings);

		// 툴바에 아이콘 추가
        this.addRibbonIcon("book", "위키독스 책 목록 가져오기", async (evt: MouseEvent) => {
            // 책 목록 가져오기 명령 실행
            const bookId = await this.promptForBookSelection();
            if (bookId) {
				this.apiClient.downloadBook(this.app, bookId);
            }
        });

		// 책 리스트에서 선택하여 가져오기
		this.addCommand({
			id: "fetch-selected-book",
			name: "위키독스 책 목록 가져오기",
			callback: async () => {
				const bookId = await this.promptForBookSelection();
				if (bookId) {
					this.apiClient.downloadBook(this.app, bookId);
				}
			},
		});
		
		// 컨텍스트 메뉴에 항목 추가
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFolder) {
					const metadataFilePath = `${file.path}/metadata.md`;
            		const metadataFile = this.app.vault.getAbstractFileByPath(metadataFilePath);
					if (metadataFile instanceof TFile) {
						// 위키독스로부터 내려받기
						menu.addItem((item) => {
							item.setTitle("위키독스 내려받기")
								.setIcon("cloud-download")
								.onClick(async () => {
									const confirmed = await showConfirmationDialog(
										"[주의] 이 책이 위키독스 기준으로 업데이트됩니다.\n" +
										"'위키독스 보내기'로 수정한 데이터를 전송했는지 확인해 주세요.\n" +
										"정말로 내려받으시겠습니까?"
									);
									if (confirmed) {
										await this.syncFromServer(file);
									} else {
										// new Notice("동작이 취소되었습니다.");
									}
								});
						});
			
						// 위키독스로 보내기
						menu.addItem((item) => {
							item.setTitle("위키독스 보내기")
								.setIcon("cloud-upload")
								.onClick(async () => {
									await this.syncToServer(file);
								});
						});
					}
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
			this.app.vault.on("rename", async (file, oldPath) => {
				const oldPathBasename = oldPath.split("/").pop();
				if (file instanceof TFile && file.name !== oldPathBasename && file.extension === "md" && file.name !== "metadata.md") {
					addFrontMatterToFile(file);
				}
			})
		);

		// 설정 탭 추가
		this.addSettingTab(new WikiDocsPluginSettingTab(this.app, this));
	}

	async onunload() {
	}
	
	async syncFromServer(folder: TFolder) {
		const folderName = folder.name;
	
		try {
			const bookId = await getBookIdFromMetadata(folder.path);
			if (!bookId) {
				new Notice(`책의 메타데이터가 존재하지 않습니다.`);
				return;
			}
	
			// Step 1: 서버에서 책 데이터 가져오기
			const bookResponse = await this.apiClient.fetchWithAuth(`/books/${bookId}/`);
			if (!bookResponse.ok) {
				new Notice("책 내려받기가 실패했습니다.");
				return;
			}

			// Step 2: 책 폴더와 페이지 삭제 (동기적 흐름)
			await deleteFolderContents(folder);
	
			// Step 3: 책 데이터를 새로 저장
			const bookData = await bookResponse.json();
			await savePagesToMarkdown(this.app, bookData.pages, folder.path);
			new Notice(`"${bookData.subject}" 책을 성공적으로 내려받았습니다.`);
			
		} catch (error) {
			console.error(`Failed to sync folder "${folderName}"`, error);
			new Notice(`책 내려받기가 실패했습니다.`);
		}
	}	
	
	async syncToServer(folder: TFolder) {
		const folderName = folder.name;
		const files = this.app.vault.getFiles().filter((file) => file.path.startsWith(folder.path));
	
		let changedCount = 0;
		let hasError = false;
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
					changedCount++;
	
					// const contentWithoutFrontMatter = ensureLineBreaks(removeFrontMatter(fileContent));
					const contentWithoutFrontMatter = removeFrontMatter(fileContent);
	
					// 이미지 파일 처리
					const embeddedImages = extractEmbeddedImages(contentWithoutFrontMatter);
					if (metadata.id != -1) { // 신규 파일이 아닌 경우에만 이미지 업로드
						await this.apiClient.uploadImagesForPage(this.app, metadata.id, embeddedImages);
					}
	
					// 서버에 업데이트
					metadata.subject = extractTitleFromFilePath(file.path);
					const page_id = await this.apiClient.updatePageOnServer(metadata, contentWithoutFrontMatter);

					if (metadata.id == -1) { // 신규 파일인 경우에 이미지 업로드후 저장 한번 더!!
						metadata.id = page_id;
						await this.apiClient.uploadImagesForPage(this.app, page_id, embeddedImages);
						await this.apiClient.updatePageOnServer(metadata, contentWithoutFrontMatter);
					}

					new Notice(`${file.name} 페이지를 성공적으로 내보냈습니다!`);
				}
			} catch (error) {
				hasError = true;
				console.error(`Failed to sync file to server: ${file.path}`, error);
			}
		}
	
		if (!hasError && changedCount > 0) {
			await this.syncFromServer(folder);
		}else {
			new Notice(`변경된 페이지가 없습니다.`);
		}
	}
	

	async promptForBookSelection(): Promise<number | null> {
		const response = await this.apiClient.fetchWithAuth(`/books/`);
		if (!response.ok) {
			new Notice("책 목록을 가져오지 못했습니다.");
			return null;
		}
		const books = await response.json();
	
		return new Promise((resolve) => {
			const modal = new Modal(this.app);
	
			modal.onClose = () => resolve(null);
	
			// 헤더
			const header = modal.contentEl.createEl("h2", {
				text: "위키독스 책을 선택해 주세요.",
			});
			header.classList.add("book-selection-header");
	
			// 리스트
			const list = modal.contentEl.createEl("ul");
			list.classList.add("book-selection-list");
	
			books.forEach((book: { id: number; subject: string }) => {
				const listItem = list.createEl("li", {
					text: book.subject,
				});
				listItem.classList.add("book-selection-list-item");
	
				listItem.addEventListener("click", () => {
					resolve(book.id);
					modal.close();
				});
			});
	
			// 빈 목록 처리
			if (books.length === 0) {
				const emptyMessage = list.createEl("li", {
					text: "책 목록이 비어 있습니다.",
				});
				emptyMessage.classList.add("book-selection-empty-message");
			}
	
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

class WikiDocsPluginSettingTab extends PluginSettingTab {
	plugin: WikiDocsPlugin;

	constructor(app: App, plugin: WikiDocsPlugin) {
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
			.addText((text) => {
				text
					.setPlaceholder("https://wikidocs.net/napi")
					.setValue(this.plugin.settings.apiBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiBaseUrl = value;
						await this.plugin.saveSettings();
					});

				// 클래스 추가
				text.inputEl.classList.add("plugin-setting-input");
			});

		new Setting(containerEl)
			.setName("API Token")
			.setDesc("API 인증 토큰을 입력합니다.")
			.addText((text) => {
				text
					.setPlaceholder("위키독스에서 발급한 토큰을 입력해 주세요.")
					.setValue(this.plugin.settings.apiToken)
					.onChange(async (value) => {
						this.plugin.settings.apiToken = value;
						await this.plugin.saveSettings();
					});

				// 클래스 추가
				text.inputEl.classList.add("plugin-setting-input");
			});
	}
}
