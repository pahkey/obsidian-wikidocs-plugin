import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from "obsidian";

import {
	deleteFolderContents,
	extractEmbeddedImages,
	extractTitleFromFilePath,
	getFileModifiedTime,
	isBlogFolder,
	isBookFolder,
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
	addBlogFrontMatterToFile,
	addBlogIconToFile,
	addBlogIconToFolder,
	addFrontMatterToFile,
	addLockIconToFile,
	BlogMetadata,
	extractMetadataFromBlogFrontMatter,
	extractMetadataFromFrontMatter,
	getBookIdFromMetadata,
	getPureContent,
	isNeedSync,
	saveBlogToMarkdown,
	savePagesToMarkdown
} from "./lib/md";

export default class WikiDocsPlugin extends Plugin {
	settings: WikiDocsPluginSettings;
	apiClient: ApiClient;

	async onload() {
		await this.loadSettings();
		this.apiClient = new ApiClient(this.settings);
		let isSyncProcess = false;
		let layout_ready = false;

		// 툴바에 아이콘 추가
        this.addRibbonIcon("book", "위키독스 책 목록 가져오기", async (evt: MouseEvent) => {
            // 책 목록 가져오기 명령 실행
            const bookId = await this.promptForBookSelection();
            if (bookId) {
				isSyncProcess = true;
				await this.apiClient.downloadBook(this.app, bookId);
				isSyncProcess = false;
            }
        });

		// 툴바에 블로그 아이콘 추가
        this.addRibbonIcon("rss", "위키독스 블로그 가져오기", async (evt: MouseEvent) => {
            // 블로그 가져오기 명령 실행
            const bookId = await this.promptForBlogSelection();
			if (bookId) {
				new Notice("블로그를 성공적으로 가져왔습니다.");
			}else {
				new Notice("블로그를 가져오기를 실패했습니다.");
			}
        });

		// 책 리스트에서 선택하여 가져오기
		this.addCommand({
			id: "fetch-selected-book",
			name: "위키독스 책 목록 가져오기",
			callback: async () => {
				const bookId = await this.promptForBookSelection();
				if (bookId) {
					isSyncProcess = true;
					await this.apiClient.downloadBook(this.app, bookId);
					isSyncProcess = false;
				}
			},
		});
		
		
		// 컨텍스트 메뉴에 항목 추가
		this.registerEvent(
			this.app.workspace.on("file-menu", async(menu, file) => {

				// wikidocs
				if (file instanceof TFolder) {
					const metadataFilePath = `${file.path}/metadata.md`;
            		const metadataFile = this.app.vault.getAbstractFileByPath(metadataFilePath);
					if (metadataFile instanceof TFile) {
						// 위키독스로부터 내려받기
						menu.addItem((item) => {
							item.setTitle("위키독스 내려받기")
								.setIcon("cloud-download")
								.onClick(async () => {
									const is_need_sync = await isNeedSync(this.app, file)
									if (is_need_sync) {
										const confirmed = await showConfirmationDialog(
											"[주의!!] 변경된 페이지가 있습니다. \n" +
											"변경된 페이지를 먼저 '위키독스 보내기'로 전송해 주세요.\n" +
											"무시하고 내려받으시겠습니까?"
										);
										if (confirmed) {
											isSyncProcess = true;
											await this.syncFromServer(file);
											isSyncProcess = false;
										}
									}else {
										isSyncProcess = true;
										await this.syncFromServer(file);
										isSyncProcess = false;
									}
								});
						});
			
						// 위키독스로 보내기
						menu.addItem((item) => {
							item.setTitle("위키독스 보내기")
								.setIcon("cloud-upload")
								.onClick(async () => {
									isSyncProcess = true;
									await this.syncToServer(file);
									isSyncProcess = false;
								});
						});
					}
				}

				// blog
				if (file instanceof TFolder) {
					const metadataFilePath = `${file.path}/blog_metadata.md`;
            		const metadataFile = this.app.vault.getAbstractFileByPath(metadataFilePath);
					if (metadataFile instanceof TFile) {
						// 위키독스로부터 내려받기
						menu.addItem((item) => {
							item.setTitle("블로그 목록조회")
								.setIcon("cloud-download")
								.onClick(async () => {
									const blog_id = await this.promptForBlogListSelection();
									if (blog_id == null) {
										return null;
									}
									const response = await this.apiClient.fetchWithAuth(`/blog/${blog_id}`);
									if (!response.ok) {
										new Notice("블로그를 가져오지 못했습니다.");
										return null;
									}
									const blog = await response.json();

									// 파일 쓰기
									if(file.parent instanceof TFolder) {
										saveBlogToMarkdown(this.app, blog, file.name);
									}
								});
						});
					}
				}
				
				if(file instanceof TFile) {
					if (file.parent) {
						const metadataFilePath = `${file.parent.path}/blog_metadata.md`;
						const metadataFile = this.app.vault.getAbstractFileByPath(metadataFilePath);
						if (metadataFile instanceof TFile && file != metadataFile) {
							menu.addItem((item) => {
								item.setTitle("블로그 보내기")
									// .setIcon("cloud-download")
									.onClick(async () => {
										await this.blog_post(file);
									});
							});

							menu.addItem((item) => {
								item.setTitle("블로그 내려받기")
									// .setIcon("cloud-download")
									.onClick(async () => {
										if (file.name === "blog_metadata.md") {
											return;
										}
										const metadata = await extractMetadataFromBlogFrontMatter(file);
							
										if (!metadata.id || metadata.id == -1) {
											console.error(`No ID found in Front Matter for file: ${file.path}`);
											return;
										}
							
										const blog_id = metadata.id;
										this.blog_update(file, blog_id);
									});
							});
						}
					}
				}
			})
		);
		
		this.app.workspace.onLayoutReady(() => {
			layout_ready = true;
		});
		
		this.registerEvent(
			this.app.vault.on("create", async (file) => {
				if (!layout_ready) {
					return;
				}

				if(isSyncProcess) {
					return;
				}

				if (file instanceof TFile && file.extension === "md") {
					const content = await this.app.vault.read(file);
					if (content.trim() === "") {  // 신규파일
						if (await isBookFolder(file)) {
							await addFrontMatterToFile(file); // Front Matter 추가
						}

						if (await isBlogFolder(file)) {
							await addBlogFrontMatterToFile(file); // Front Matter 추가
						}

					}else { // 기존 파일 (syncFromServer로 생성된 파일 이벤트 + duplicate 이벤트)
						if (file.name === 'metadata.md' || file.name === 'blog_metadata.md') {
							return;
						}
						await new Promise(resolve => setTimeout(resolve, 100));

						let metadata;
						if (await isBookFolder(file)) {
							metadata = await extractMetadataFromFrontMatter(file);
						}
						
						if (await isBlogFolder(file)) {
							metadata = await extractMetadataFromBlogFrontMatter(file);
						}
						
						if (metadata && metadata.last_synced) {
							const now = new Date();
							const lastSyncedDate = new Date(metadata.last_synced);
							const timeDifferenceInSeconds = Math.floor((now.getTime() - lastSyncedDate.getTime()) / 1000);
							if (timeDifferenceInSeconds > 1) { // 파일 생성시간과 현재 시간이 1초 이상 차이날 경우 duplicate 파일임
								metadata.id = -1; // 신규 파일로
								metadata.last_synced = ''; // 동기화를 위해 비워둔다.
								const frontMatter = metadata.getFrontMatter();
								const updatedContent = frontMatter + getPureContent(content);
								await this.app.vault.modify(file, updatedContent);
							}
						}
					}
				}
			})
		);

		const recentRenamedFolderPaths = new Set<string>();
		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				// book
				if(await isBookFolder(file)) {
					if (file instanceof TFolder) {
						new Notice("폴더명 변경은 위키독스에 반영되지 않습니다.");
						recentRenamedFolderPaths.add(file.path);
						setTimeout(() => {
							recentRenamedFolderPaths.delete(file.path)
						}, 1000); // some reasonable timeout
					} else {
						if (file instanceof TFile && file.parent) {
							if (recentRenamedFolderPaths.has(file.parent.path)) {
								// after renamed folder
								// do nothing
								return;
							} else {
								// after drag-and-drop
								if (file.extension === "md" && file.name !== "metadata.md") {
									addFrontMatterToFile(file);
								}
							}
						}
					}
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on("file-open", async (file) => {
				if (file instanceof TFile) {
					if (await isBookFolder(file)) {
						addLockIconToFile(file);
					}
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
					const embeddedImages = extractEmbeddedImages(file);
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

	async promptForBlogSelection(): Promise<Response | null> {
		const answer = window.confirm("블로그를 가져오시겠습니까?");
		if (answer) {
			const response = await this.apiClient.fetchWithAuth("/blog/profile/");
			if (response.ok) {
				const data = await response.json();
				
				// data.name 에 해당하는 폴더가 없으면 폴더를 생성하고
				if (!this.app.vault.getAbstractFileByPath(data.name)) {
					await this.app.vault.createFolder(data.name);
					addBlogIconToFolder(data.name);
				}else {
					new Notice("블로그 폴더가 이미 존재합니다.");
					return null;
				}

				// metadata.md 파일을 생성한다.
				const metadataPath = `${data.name}/blog_metadata.md`;
				const metadataContent = `---\n` +
					`id: ${data.id}\n` +
					`url: ${data.url}\n` +
					`name: ${data.name}\n` +
					`---\n`;
				
				await this.app.vault.create(metadataPath, metadataContent);
				return data.id;
			}
		}

		return null;
	}

	async promptForBlogListSelection(): Promise<number | null> {
		let currentPage = 1;
		let hasMore = true;
		
		return new Promise((resolve) => {
			const modal = new Modal(this.app);
			modal.onClose = () => resolve(null);
			
			// 헤더
			const header = modal.contentEl.createEl("h2", {
				text: "블로그를 선택해 주세요.",
			});
			header.classList.add("book-selection-header");
			
			// 리스트
			const list = modal.contentEl.createEl("ul");
			list.classList.add("book-selection-list");
			
			// 더 보기 버튼을 위한 컨테이너
			const loadMoreContainer = modal.contentEl.createEl("div");
			loadMoreContainer.classList.add("load-more-container");
			loadMoreContainer.style.textAlign = "center";
			loadMoreContainer.style.marginTop = "10px";
			
			// 블로그 목록 로드 함수
			const loadBlogPages = async (page: number) => {
				const response = await this.apiClient.fetchWithAuth(`/blog/list/${page}`);
				if (!response.ok) {
					new Notice("더 이상 가져올 블로그 목록이 없습니다.");
					return false;
				}
				
				const blog = await response.json();
				const blog_pages = blog.blog_pages;
				
				// 더 보기 버튼 표시 여부 결정
				hasMore = blog_pages.length > 0;
				
				// 블로그 항목 추가
				blog_pages.forEach((blog: { id: number; title: string; is_public: boolean }) => {
					const listItem = list.createEl("li");
					
					// 공개 여부 표시
					const statusIcon = listItem.createEl("span", {
						text: blog.is_public ? "🌐 " : "🔒 "
					});
					
					// 제목 표시
					listItem.appendChild(document.createTextNode(blog.title));
					listItem.classList.add("book-selection-list-item");
					
					// 항목 클릭 이벤트
					listItem.addEventListener("click", () => {
						resolve(blog.id);
						modal.close();
					});
				});
				
				// 더 보기 버튼 업데이트
				updateLoadMoreButton();
				
				return blog_pages.length > 0;
			};
			
			// 더 보기 버튼 업데이트 함수
			const updateLoadMoreButton = () => {
				// 기존 버튼 제거
				loadMoreContainer.empty();
				
				if (hasMore) {
					const loadMoreButton = loadMoreContainer.createEl("button", {
						text: "더 보기",
					});
					loadMoreButton.classList.add("load-more-button");
					loadMoreButton.style.padding = "5px 15px";
					loadMoreButton.style.cursor = "pointer";
					
					loadMoreButton.addEventListener("click", async () => {
						currentPage++;
						const hasItems = await loadBlogPages(currentPage);
						if (!hasItems) {
							hasMore = false;
							updateLoadMoreButton();
						}
					});
				} else if (currentPage > 1) {
					// 더 이상 항목이 없을 때 메시지 표시 (첫 페이지가 아닌 경우에만)
					loadMoreContainer.createEl("span", {
						text: "마지막 페이지입니다.",
					});
				}
			};
			
			// 초기 데이터 로드
			(async () => {
				const hasItems = await loadBlogPages(currentPage);
				
				// 빈 목록 처리
				if (!hasItems && currentPage === 1) {
					const emptyMessage = list.createEl("li", {
						text: "작성된 블로그가 없습니다.",
					});
					emptyMessage.classList.add("book-selection-empty-message");
					hasMore = false;
					updateLoadMoreButton();
				}
			})();
			
			modal.open();
		});
	}


	async blog_post(file: TFile) {
		try {
			if (file.name === "blog_metadata.md") {
				// metadata.md 파일은 업로드하지 않음
				return;
			}

			const fileContent = await this.app.vault.read(file);
			const metadata = await extractMetadataFromBlogFrontMatter(file);

			if (!metadata.id) {
				console.error(`No ID found in Front Matter for file: ${file.path}`);
				return;
			}

			// 동기화 시점 확인
			const lastSynced = metadata.last_synced ? new Date(metadata.last_synced) : null;
			const fileModifiedAt = getFileModifiedTime(file);

			// const contentWithoutFrontMatter = ensureLineBreaks(removeFrontMatter(fileContent));
			

			// id가 -1인 경우에는 블로그 생성
			let blog_id = -1;
			if(metadata.id == -1) {
				const response = await this.apiClient.fetchWithAuth(`/blog/create/`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({}),
				});

				// 결과 처리
				if (response.ok) {
					const data = await response.json();
					blog_id = data.id;
				} else {
					console.error(`Failed to create blog`);
					return;
				}
			}else {
				blog_id = metadata.id;
			}

			// 이미지 파일 처리
			const embeddedImages = extractEmbeddedImages(file);
			if (embeddedImages) {
				const imageMap = await this.apiClient.uploadImagesForBlog(this.app, blog_id, embeddedImages);
			}
			
			// 블로그 보내기
			const title = extractTitleFromFilePath(file.path);
			const content = removeFrontMatter(fileContent);
			try {
				metadata.tags = metadata.tags.join(',')
			}catch(e) {
			}

			const response = await this.apiClient.fetchWithAuth(`/blog/${blog_id}/`, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					"title": title,
					"content": content,
					"is_public": metadata.is_public,
					"tags": metadata.tags,
				}),
			});

			if (response.ok) {
				const data = await response.json();
				new Notice(`${file.name} 블로그를 성공적으로 내보냈습니다!`);
				this.blog_update(file, blog_id);

			} else {
				console.error(`Failed to create blog`);
				return;
			}
		} catch (error) {
			console.error(`블로그 포스팅을 실패했습니다.: ${file.path}`, error);
		}
	}

	async blog_update(file:TFile, blog_id:number) {
		try {
			const response = await this.apiClient.fetchWithAuth(`/blog/${blog_id}`);
			if (!response.ok) {
				console.error(`블로그 가져오기 실패.`);
				return;
			}
			const blog = await response.json();
			const new_metadata = new BlogMetadata(blog);
			const now = new Date().toISOString();
			new_metadata.last_synced = now;
			const frontMatter = new_metadata.getFrontMatter();
			
			// 페이지 내용 추가
			const content = frontMatter + (blog.content ?? "No content available.");
	
			// 파일 변경
			if(file.parent) {
				const folderPath = sanitizeFileName(blog.title);
				await this.app.vault.rename(file, `${file.parent.name}/${folderPath}.md`);
				await this.app.vault.modify(file, content);
				await addBlogIconToFile(`${file.parent.name}/${folderPath}.md`, blog);
			}
			
			new Notice("블로그를 성공적으로 가져왔습니다.");
			
		} catch (error) {
			console.error(`블로그 가져오기를 실패했습니다.: ${file.path}`, error);
		}
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

